/** Cloud UI copy, separate from DeepSeek platform login. */
export const en = {
  title: 'DSH Cloud', server: 'Server URL', connect: 'Sign in to dsh-server', authorize: 'Continue in your browser',
  logout: 'Sign out and return to local', close: 'Close', local: 'Local mode', authenticating: 'Waiting for cloud sign-in',
  cloud: 'Cloud mode', 'cloud-suspended': 'Cloud paused',
  policy: 'Sign-in stops local tasks. Cloud failures pause execution. Nothing falls back to this computer.',
  failure: 'The operation did not complete. Check the saved operation ID before retrying.',
  retry: 'Refresh', tenant: 'Tenant', workspace: 'Workspace', choose: 'Choose…', name: 'Name', slug: 'Slug',
  createTenant: 'Create tenant', createWorkspace: 'Create workspace', runtime: 'Sandbox', allocate: 'Allocate sandbox',
  start: 'Start sandbox', stop: 'Stop sandbox', command: 'Cloud command', execute: 'Run in cloud',
  model: 'Model', endpoint: 'Model endpoint', apiKey: 'API key', saveCredential: 'Save cloud model credential',
  credential: 'Model credential', session: 'Cloud conversation', createSession: 'New cloud conversation',
  prompt: 'Message to cloud DSH', send: 'Send', cancel: 'Cancel operation', history: 'Operations',
  path: 'Relative cloud path', read: 'Read file', list: 'List directory', write: 'Write file', content: 'File text (up to 16 KiB)',
  files: 'Cloud files', upload: 'Upload selected file to RustFS', download: 'Download', storage: 'RustFS objects',
  desktop: 'Private desktop', createDesktop: 'Allocate desktop', desktopStart: 'Start desktop', desktopStop: 'Stop desktop',
  screenshot: 'Desktop screenshot', desktopAlt: 'Cloud private desktop screenshot',
  browser: 'Cloud browser', browserUrl: 'Offline URL (about:blank or data:text/html,)', navigate: 'Navigate in cloud',
  browserContent: 'Read page', type: 'Type on cloud desktop', text: 'Desktop text',
  events: 'Cloud conversation events', result: 'Operation result', waiting: 'Working…',
  empty: 'No items', localBlocked: 'Local operations remain paused. Reconnect or explicitly sign out.',
  uploadHint: 'Only the file you select is uploaded. Local folders are never mounted automatically.',
} as const
/** Keys shared by cloud UI dictionaries. */
export type CloudKey = keyof typeof en
/** Chinese cloud UI dictionary. */
export const zh: Record<CloudKey, string> = {
  title: 'DSH 云端', server: '服务器地址', connect: '登录 dsh-server', authorize: '在浏览器中继续登录',
  logout: '退出云端并返回本地', close: '关闭', local: '本地模式', authenticating: '等待云端登录',
  cloud: '云端模式', 'cloud-suspended': '云端已暂停',
  policy: '登录会停止本地任务；云端异常时暂停执行，所有任务都不会回退到本机',
  failure: '操作未完成，请先根据保留的任务编号查询结果，再决定是否重试',
  retry: '刷新', tenant: '租户', workspace: '工作空间', choose: '请选择…', name: '名称', slug: '唯一标识',
  createTenant: '创建租户', createWorkspace: '创建工作空间', runtime: '云端沙箱', allocate: '分配沙箱',
  start: '启动沙箱', stop: '停止沙箱', command: '云端命令', execute: '在云端执行',
  model: '模型', endpoint: '模型接口地址', apiKey: 'API Key', saveCredential: '保存云端模型凭据',
  credential: '模型凭据', session: '云端会话', createSession: '新建云端会话',
  prompt: '发送给云端 DSH 的消息', send: '发送', cancel: '取消任务', history: '任务历史',
  path: '云端相对路径', read: '读取文件', list: '列出目录', write: '写入文件', content: '文件文本（最多 16 KiB）',
  files: '云端文件', upload: '将所选文件上传到 RustFS', download: '下载', storage: 'RustFS 文件',
  desktop: '私有桌面', createDesktop: '分配桌面', desktopStart: '启动桌面', desktopStop: '停止桌面',
  screenshot: '桌面截图', desktopAlt: '云端私有桌面截图',
  browser: '云端浏览器', browserUrl: '离线地址（about:blank 或 data:text/html,）', navigate: '在云端打开',
  browserContent: '读取网页', type: '向云端桌面输入', text: '桌面输入文本',
  events: '云端会话事件', result: '任务结果', waiting: '处理中…',
  empty: '暂无内容', localBlocked: '本地操作保持暂停，请重新登录或明确退出云端',
  uploadHint: '只上传你明确选择的文件，不会自动挂载本地目录',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'dsh.cloud': CloudKey }
}
