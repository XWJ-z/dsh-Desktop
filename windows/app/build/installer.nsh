; ─────────────────────────────────────────────────────────────────────────
; DSH-Desktop 安装器自定义脚本（安装时显示"正在干啥"）
;
; ⚠ electron-builder 模板坑（源码 + mini 安装器 UIA 实验实锤）：
;   1. common.nsh 有 `ShowInstDetails nevershow`（只有进度条）→ customHeader
;      宏（模板在 common.nsh 之后展开）覆盖为 show，详情区展开；
;   2. installSection.nsh 有 `${IfNot} ${Silent} SetDetailsPrint none` → 解压
;      阶段 DetailPrint 被抑制 + 7z 静默解压无逐文件日志 → 详情区空白；
;   3. 修复：MUI_PAGE_CUSTOMFUNCTION_SHOW 必须在 MUI_PAGE_INSTFILES 之前定义，
;     且是全局 define（放最前面会污染欢迎页 → 构建报错）—— 放进
;     customPageAfterChangeDir 宏（assisted 模板在 instfiles 之前展开它），
;     只给安装页挂 SHOW 回调：进入安装页就先写一行「正在解压…」，
;     解压期间详情区常驻内容（进度条旁边有文字，不再是空白框）。
;   4. customInstall 里 SetDetailsPrint both 恢复输出，收尾阶段追加阶段日志。
; ─────────────────────────────────────────────────────────────────────────
!macro customHeader
  ShowInstDetails show
!macroend

; 只给 instfiles 页面挂 SHOW 回调（define 必须紧跟 MUI_PAGE_INSTFILES 之前；
; 放最前面会全局污染欢迎/完成页导致构建报错 —— 放 customPageAfterChangeDir
; 宏里，electron-builder assisted 模板恰好在此处展开、位于 instfiles 之前）
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW instFilesShow
!macroend

; 安装页显示时：详情区先写一行提示（此刻 SetDetailsPrint 尚未被 none 抑制，
; 可显示；用户点「安装」后解压期间该行常驻 —— 7z 静默解压无逐文件日志）
; ⚠ 必须包在 !ifndef BUILD_UNINSTALLER 里：electron-builder 先编译卸载器，
;   卸载器里本函数未被引用 → NSIS 6010 警告 → -WX 视为错误 → 构建失败
!ifndef BUILD_UNINSTALLER
Function instFilesShow
  DetailPrint "正在解压应用文件（约 114MB），请稍候…"
FunctionEnd
!endif

; 安装收尾阶段：恢复详情输出 + 阶段日志
!macro customInstall
  SetDetailsPrint both
  DetailPrint "正在创建桌面/开始菜单快捷方式…"
  DetailPrint "正在注册卸载入口（控制面板/应用和功能）…"
  DetailPrint "安装完成！首次启动将自动准备 DSH 运行环境（约 1-3 分钟）"
!macroend
