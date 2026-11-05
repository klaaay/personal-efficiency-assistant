import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacy } from '../src/migration.ts';

test('原 DeepSeek API 和所有提示词、启用项、语言及开关完整迁移', () => {
  const prompts = [
    { id: 'one', title: '默认', question: ' {{CONTENT}}\n{{TITLE}} ', systemMessage: '使用 {{SELECTED_LANGUAGE}}。' },
    { id: 'two', title: '研究', question: '{{URL}}\n{{TEXT_CONTENT}}', systemMessage: '' },
  ];
  const raw = { provider: 'deepseek-api', model: 'deepseek-reasoner', apiKey: 'test-deepseek', promptSettings: { prompts, activePromptId: 'two' }, selectedLanguage: 'zh', showSummarizeButton: false, showYoutubeButton: true, summarizeFullText: false };
  const before = JSON.stringify(raw);
  const result = migrateLegacy(raw);
  assert.equal(result.profiles[0].endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(result.profiles[0].apiKey, 'test-deepseek');
  assert.equal(result.profiles[0].model, 'deepseek-reasoner');
  assert.deepEqual(result.prompts, prompts);
  assert.equal(result.activePromptId, 'two');
  assert.equal(result.language, 'zh');
  assert.deepEqual(result.preferences, { showSummarizeButton: false, showYoutubeButton: true, summarizeFullText: false });
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(result.warnings, []);
});

test('local 优先且 provider/model/apiKey 不跨存储区域拼接', () => {
  const result = migrateLegacy({ local: { provider: 'deepseek-api', selectedLanguage: 'en' }, sync: { provider: 'api', apiKey: 'other-service-key', model: 'other-service-model' } });
  assert.equal(result.profiles[0].apiKey, '');
  assert.equal(result.profiles[0].model, 'deepseek-chat');
  assert.ok(result.warnings.some(value => value.includes('没有混用')));
  assert.ok(result.warnings.every(value => !value.includes('other-service')));
  const syncOnly = migrateLegacy({ local: {}, sync: { provider: 'api', apiKey: 'openai-test', model: 'custom-model' } });
  assert.equal(syncOnly.profiles[0].endpoint, 'https://api.openai.com/v1/chat/completions');
  assert.equal(syncOnly.profiles[0].apiKey, 'openai-test');
});

test('网页登录模式、未知 provider 和孤立 apiKey 不得迁移为 API 凭证', () => {
  for (const provider of ['web', 'deepseek-chat', 'unknown', undefined]) {
    const result = migrateLegacy({ provider, apiKey: 'do-not-use', 'deepseek-token': 'private-token', password: 'private-password' });
    assert.deepEqual(result.profiles, []);
    const serialized = JSON.stringify(result);
    for (const secret of ['do-not-use', 'private-token', 'private-password']) assert.ok(!serialized.includes(secret));
  }
});

test('旧 question/systemMessage 保留空白与模板变量，缺失语言不猜测', () => {
  const result = migrateLegacy({ question: '  {{CONTENT}}  ', systemMessage: '\n系统提示词\n' });
  assert.deepEqual(result.prompts, [{ id: 'legacy-default', title: 'Default Prompt', question: '  {{CONTENT}}  ', systemMessage: '\n系统提示词\n' }]);
  assert.equal(result.activePromptId, 'legacy-default');
  assert.equal(result.language, '');
});

test('损坏提示词保留可读内容并明确报告，不在错误中输出配置值', () => {
  const result = migrateLegacy({ promptSettings: { prompts: [null, { id: 'same', title: 'A', question: 'secret-prompt' }, { id: 'same', title: 'B', question: 'second' }, { question: 1 }], activePromptId: 'missing' } });
  assert.equal(result.prompts.length, 3);
  assert.equal(new Set(result.prompts.map(prompt => prompt.id)).size, 3);
  assert.equal(result.prompts[0].question, 'secret-prompt');
  assert.equal(result.activePromptId, result.prompts[0].id);
  assert.ok(result.warnings.length >= 4);
  assert.ok(result.warnings.every(value => !value.includes('secret-prompt')));
  assert.throws(() => migrateLegacy(null), /JSON 对象/);
  assert.throws(() => migrateLegacy([]), /JSON 对象/);
});
