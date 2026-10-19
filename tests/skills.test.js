import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { SkillRegistry, REQUIRED_TOOLS } from '../src/skills.js';

function createDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metric-ask-skills-'));
  return new PlatformDatabase(path.join(directory, 'test.db'));
}

test('skill registry selects agent instructions and keeps required tools', () => {
  const database = createDatabase();
  const registry = new SkillRegistry(database);
  const theme = database.listThemes().find((item) => item.name === '经营总览');
  const skills = registry.listForTheme({
    ...theme,
    skillCodes: ['trend_analysis'],
  });
  assert.ok(skills.some((skill) => skill.code === 'trend_analysis'));

  const tools = [
    { type: 'function', function: { name: 'search_indicators' } },
    { type: 'function', function: { name: 'get_indicator' } },
    { type: 'function', function: { name: 'compile_query_contract' } },
    { type: 'function', function: { name: 'execute_query_contract' } },
    { type: 'function', function: { name: 'list_workspace_artifacts' } },
    { type: 'function', function: { name: 'transform_workspace_artifact' } },
    { type: 'function', function: { name: 'execute_analysis_code' } },
    { type: 'function', function: { name: 'search_user_memory' } },
    { type: 'function', function: { name: 'request_clarification' } },
    { type: 'function', function: { name: 'unregistered_tool' } },
  ];
  const enabledTools = registry.filterTools(tools, skills);
  assert.deepEqual(
    enabledTools.map((tool) => tool.function.name),
    REQUIRED_TOOLS,
  );
  assert.ok(registry.buildInstructions(skills).some((line) => line.includes('趋势')));
});

test('theme skill assignments can be replaced independently', () => {
  const database = createDatabase();
  const theme = database.listThemes().find((item) => item.name === '财务分析');
  database.replaceThemeSkills(theme.id, [
    'indicator_search',
    'indicator_definition',
    'indicator_query',
    'period_comparison',
  ]);
  assert.deepEqual(database.getTheme(theme.id).skillCodes.sort(), [
    'indicator_definition',
    'indicator_query',
    'indicator_search',
    'period_comparison',
  ]);
});

test('agent model, dataset and example configuration persist on the theme', () => {
  const database = createDatabase();
  const theme = database.listThemes().find((item) => item.name === '经营总览');
  const updated = database.saveTheme({
    ...theme,
    llmConfig: {
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      temperature: 0.2,
      maxToolRounds: 8,
    },
    datasetIds: ['1'],
    semanticValueConfig: {
      enabled: true,
      autoDiscover: false,
      fields: {
        'INDICATOR:2:business_type_name': true,
        'INDICATOR:2:customer_name': false,
      },
    },
    examples: ['近7天销售额趋势'],
  }, theme.id);

  assert.equal(updated.llmConfig.model, 'deepseek-reasoner');
  assert.deepEqual(updated.datasetIds, ['1']);
  assert.equal(updated.semanticValueConfig.autoDiscover, false);
  assert.equal(
    updated.semanticValueConfig.fields['INDICATOR:2:business_type_name'],
    true,
  );
  assert.deepEqual(updated.examples, ['近7天销售额趋势']);
});

test('core resolver skills can be hot-plugged without changing the agent contract', () => {
  const database = createDatabase();
  const registry = new SkillRegistry(database);
  const theme = database.listThemes()[0];
  const skills = registry.listForTheme(theme);

  const builtin = registry.resolveCoreSkill(
    'temporal_expression',
    { question: '昨天销售额' },
    skills,
  );
  assert.equal(builtin.dateMode, 'BETWEEN');

  registry.registerCoreResolver('temporal_expression', () => ({
    dateMode: 'BETWEEN',
    startDate: '2099-01-01',
    endDate: '2099-01-02',
  }));
  assert.equal(
    registry.resolveCoreSkill('temporal_expression', { question: '昨天销售额' }, skills).startDate,
    '2099-01-01',
  );

  registry.unregisterCoreResolver('temporal_expression');
  assert.equal(
    registry.resolveCoreSkill('temporal_expression', { question: '昨天销售额' }, skills),
    null,
  );
});

test('removing a core skill from a theme disables its resolver', () => {
  const database = createDatabase();
  const registry = new SkillRegistry(database);
  const theme = database.listThemes()[0];
  const enabled = registry.listForTheme(theme);
  assert.ok(registry.resolveCoreSkill('business_vocabulary', {
    question: '按月销售额趋势',
  }, enabled));

  database.replaceThemeSkills(theme.id, enabled
    .filter((skill) => skill.code !== 'yolo-core-skill.business_vocabulary')
    .map((skill) => skill.code));
  const disabled = registry.listForTheme(database.getTheme(theme.id));
  assert.equal(registry.resolveCoreSkill('business_vocabulary', {
    question: '按月销售额趋势',
  }, disabled), null);
});

test('core resolver requires the declared skill to match the trusted executor', () => {
  const database = createDatabase();
  const registry = new SkillRegistry(database);
  const skills = registry.listForTheme(database.listThemes()[0]);
  const forged = skills.map((skill) => skill.code === 'yolo-core-skill.temporal_expression'
    ? {
      ...skill,
      source: 'SKILL_MD',
      category: 'CORE',
      kind: 'RESOLVER',
      metadata: { resolverName: 'arbitrary_executor' },
    }
    : skill);
  assert.equal(registry.resolveCoreSkill(
    'temporal_expression', { question: '昨天销售额' }, forged,
  ), null);
});
