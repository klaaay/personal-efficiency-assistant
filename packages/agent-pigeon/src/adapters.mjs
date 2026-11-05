import path from 'node:path';

const EVENTS = new Set(['task-complete', 'task-error', 'needs-attention']);
const ALIASES = new Map([
  ['codex-cli', 'codex'], ['claude-code', 'claude'], ['gemini-cli', 'gemini'],
]);
const LABELS = { 'task-complete': '✅ 已完成', 'task-error': '❌ 出错', 'needs-attention': '⚠️ 需要处理' };
const NO_REPLY_SUFFIX = '──────── 仅通知 · 请勿直接回复 ────────';

// 以 UTF-16 长度限制 Telegram 文本；边界不留下半个代理对。
function text(value, limit = 3000) {
  if (typeof value !== 'string') return '';
  let result = value.slice(0, limit).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
  return result.toWellFormed();
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function errorText(value) {
  if (typeof value === 'string') return text(value);
  const error = record(value);
  return text(error.message) || text(record(error.data).message) || text(error.name);
}

/** 仅转换显式 hook 数据，不读取会话日志，也不执行或转发工具输入。 */
export function normalizeEvent(agent, payload) {
  if (typeof agent !== 'string') throw new TypeError('Agent 名称必须是字符串');
  agent = ALIASES.get(agent) || agent;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Hook 数据必须是 JSON 对象');
  }
  const p = payload;
  let event;
  let details = '';
  let sessionId = p.session_id ?? p.sessionId;
  let turnId = p.turn_id ?? p.turnId;
  let cwd = p.cwd ?? p.directory;
  let eventId = p.event_id ?? p.eventId;

  switch (agent) {
    case 'codex':
      if (p.type !== 'agent-turn-complete') return null;
      event = 'task-complete';
      sessionId = p['thread-id'];
      turnId = p['turn-id'];
      details = text(p['last-assistant-message']);
      break;
    case 'claude':
      switch (p.hook_event_name) {
        case 'Stop':
          event = 'task-complete'; details = text(p.last_assistant_message); break;
        case 'StopFailure':
          event = 'task-error'; details = text(p.error_details) || errorText(p.error) || text(p.last_assistant_message); break;
        case 'Notification':
          // 登录成功不是需要人工处理的任务事件。
          if (p.notification_type === 'auth_success') return null;
          event = 'needs-attention'; details = text(p.message); break;
        case 'PermissionRequest':
          event = 'needs-attention'; details = `等待工具授权：${text(p.tool_name, 120) || '未知工具'}`; break;
        case 'PreToolUse':
          if (!['AskUserQuestion', 'ExitPlanMode'].includes(p.tool_name)) return null;
          event = 'needs-attention';
          details = p.tool_name === 'AskUserQuestion' ? 'Agent 有问题需要你回答' : 'Agent 等待确认计划';
          break;
        default: return null;
      }
      break;
    case 'gemini':
      if (p.hook_event_name === 'AfterAgent') {
        event = 'task-complete'; details = text(p.prompt_response);
      } else if (p.hook_event_name === 'Notification') {
        event = 'needs-attention'; details = text(p.message);
      } else return null;
      break;
    case 'cursor': {
      const name = p.hook_event_name ?? p.event;
      if (name && name !== 'stop') return null;
      if (p.status === 'completed') event = 'task-complete';
      else if (p.status === 'error' || p.status === 'aborted') event = 'task-error';
      else return null;
      sessionId = p.conversation_id ?? sessionId;
      turnId = p.generation_id ?? turnId;
      cwd = cwd ?? (Array.isArray(p.workspace_roots) ? p.workspace_roots[0] : undefined);
      details = p.status === 'aborted' ? '任务已中止' : text(p.error_message) || text(p.summary);
      break;
    }
    case 'opencode': {
      const incoming = typeof p.event === 'object' ? record(p.event) : p;
      const props = record(incoming.properties);
      // 只接收 session.idle，避免 session.status 的 idle 重复通知。
      if (incoming.type === 'session.idle') event = 'task-complete';
      else if (incoming.type === 'session.error') {
        event = 'task-error'; details = errorText(props.error);
      } else if (incoming.type === 'permission.asked' || incoming.type === 'question.asked') {
        event = 'needs-attention';
        details = incoming.type === 'permission.asked' ? 'Agent 等待工具授权' : 'Agent 有问题需要你回答';
        eventId = eventId ?? props.id;
      } else return null;
      sessionId = props.sessionID ?? record(props.info).id ?? sessionId;
      break;
    }
    case 'generic':
      if (!EVENTS.has(p.event)) return null;
      event = p.event;
      agent = text(p.agent, 80) || 'generic';
      details = text(p.details);
      break;
    default: throw new TypeError(`不支持的 Agent：${text(agent, 80)}`);
  }

  const result = {
    agent, event,
    sessionId: text(sessionId, 256), turnId: text(turnId, 256),
    cwd: text(cwd, 1024), details,
  };
  if (text(eventId, 256)) result.eventId = text(eventId, 256);
  return result;
}

/** 纯文本消息；发送方不得指定 parse_mode，避免将 Agent 文本当作标记执行。 */
export function formatMessage(event) {
  if (!event || !EVENTS.has(event.event)) throw new TypeError('通知事件无效');
  const lines = [`${LABELS[event.event]} · ${text(event.agent, 80) || 'Agent'}`];
  const cwd = text(event.cwd, 1024);
  if (cwd) lines.push(`项目：${path.posix.basename(cwd.replaceAll('\\', '/').replace(/\/$/, '')) || '/'}`);
  const session = text(event.sessionId, 256);
  if (session) lines.push(`会话：${session}`);
  const details = text(event.details);
  if (details) lines.push('', details);
  const footer = `\n\n${NO_REPLY_SUFFIX}`;
  return `${text(lines.join('\n'), 4000 - footer.length)}${footer}`;
}
