# T-023 代码签名：Azure Trusted Signing 开通与配置指南

> 目标：消除 Windows SmartScreen「未知发布者」警告，正式分发 DSH-Desktop。
> 方案：**Azure Trusted Signing**（微软云签名服务）——无需购买证书、无需硬件
> 令牌，按签名次数计费（约 ¥100–200/月基础 + 几分钱/次），CI 自动签名友好。
> 前置：需要 Azure 订阅（个人账号即可，首次有免费额度）。

---

## 一、概念速览

| 术语 | 说明 |
|------|------|
| Trusted Signing Account | 签名账户（资源），一个订阅下可建多个 |
| Certificate Profile | 证书配置文件，决定签名的信任类型/有效期 |
| Publisher Name | 签名里的"发布者"名称，用户会在 SmartScreen 看到 |
| Entra ID 应用（Service Principal） | 签名时用来向微软认证的身份，权限最小化 |

签名链路：electron-builder → `Invoke-TrustedSigning`（PowerShell 模块）→ 用
Entra ID 身份向微软云请求签名 → 微软用其根证书签名你的 exe。

---

## 二、开通步骤（Azure 门户，需管理员操作，约 30–60 分钟）

### 1. 准备 Azure 订阅
- 若无订阅：访问 <https://azure.microsoft.com/free> 注册（个人邮箱 + 信用卡验证，
  免费额度 12 个月；Trusted Signing 本身有免费档）。
- 记下订阅 ID（订阅 → 概览）。

### 2. 注册 Trusted Signing 资源提供程序
Azure 门户 → 订阅 → 你的订阅 → 资源提供程序（Resource providers）→ 搜索
`Microsoft.CodeSigning` → 注册（Register）。等待状态变为 "Registered"。

### 3. 创建 Trusted Signing 账户
1. 搜索并进入 **Trusted Signing**（或 Artifact Signing）服务 → 创建；
2. 选择订阅、资源组（新建 `dsh-signing`）；
3. 账户名：`dsh-trusted-signing`（即 `codeSigningAccountName`）；
4. 区域：选最近的（如 **East US**）——**记下区域**，端点形如
   `https://eastus.trustedsigning.azure.net`；
5. 创建后进入账户 → **Identity validation（身份验证）**：
   - 选择组织验证（Organization validation，需营业执照等资料，审核 1–5 个工作日）
     或 个人验证（Individual validation，用个人身份，审核更快，适合个人项目）；
   - 按提示提交资料，等待 **Validated** 状态。
   > 审核通过前无法创建公共信任的证书配置文件。

### 4. 创建证书配置文件（Certificate Profile）
1. 账户内 → **Certificate profiles** → 创建；
2. 名称：`dsh-code-signing`（即 `certificateProfileName`）；
3. 信任类型：**Public Trust**（公共信任，消除 SmartScreen 必需）；
4. 证书有效期：按需（1 年/3 年，越长越省事）；
5. 创建后记下 Profile 名称。

### 5. 创建 Entra ID 应用（Service Principal）并授权
1. 门户搜索 **Microsoft Entra ID** → 应用注册 → 新注册：
   - 名称：`dsh-signing-sp`；
   - 记下 **应用程序(客户端) ID**（= `AZURE_CLIENT_ID`）与 **目录(租户) ID**（= `AZURE_TENANT_ID`）；
2. 在该应用 → 证书和密码 → 新建客户端密码（= `AZURE_CLIENT_SECRET`，**只显示一次**）；
3. 回到 Trusted Signing 账户 → **Access control (IAM)** → 添加角色分配：
   - 角色：**Trusted Signing Certificate Profile Signer**；
   - 成员：选择刚注册的应用 `dsh-signing-sp`。

### 6. 本机验证（可选，先跑通再配 electron-builder）
PowerShell 安装签名模块并测试：
```powershell
Install-Module -Name TrustedSigning -Scope CurrentUser -Force
$env:AZURE_TENANT_ID = "<租户ID>"
$env:AZURE_CLIENT_ID = "<应用ID>"
$env:AZURE_CLIENT_SECRET = "<客户端密码>"
Invoke-TrustedSigning -Endpoint "https://eastus.trustedsigning.azure.net" `
  -CodeSigningAccountName "dsh-trusted-signing" `
  -CertificateProfileName "dsh-code-signing" `
  -FileDigest SHA256 -TimestampRfc3161 "http://timestamp.acs.microsoft.com" `
  -TimestampDigest SHA256 -Files "C:\path\to\test.exe"
# 验证签名：Get-AuthenticodeSignature test.exe → Status: Valid
```

---

## 三、接入 DSH-Desktop 构建（我已配好占位）

### 1. 填写 electron-builder.yml
`app/electron-builder.yml` 的 `win:` 下已写好 `azureSignOptions` 注释模板，
将三个值替换为实际值并取消注释：
```yaml
win:
  icon: assets/icon.ico
  target:
    - target: nsis
      arch:
        - x64
  azureSignOptions:
    publisherName: "你的发布者名称"                    # 与证书 Profile 一致
    endpoint: "https://eastus.trustedsigning.azure.net" # 账户区域端点
    certificateProfileName: "dsh-code-signing"
    codeSigningAccountName: "dsh-trusted-signing"
```

### 2. 提供认证环境变量（不要写进仓库）
构建安装包前设置：
```powershell
$env:AZURE_TENANT_ID = "<租户ID>"
$env:AZURE_CLIENT_ID = "<应用ID>"
$env:AZURE_CLIENT_SECRET = "<客户端密码>"
cd app
npm run installer
```
> 三个变量缺一不可（electron-builder 走 Azure.Identity EnvironmentCredential）。
> 凭据不要提交到 git；可放本机 `$env:` 或 CI 的 secret。

### 3. 验证签名
```powershell
Get-AuthenticodeSignature "app\dist\installer\DSH-Desktop-Setup-0.4.2.exe"
# 期望：Status = Valid，SignerCertificate 指向 Microsoft 的 Trusted Signing 根
```

---

## 四、SmartScreen 信誉说明（重要预期管理）

- 签名后第一版仍可能短暂出现「Windows 已保护你的电脑」——这是**新发布者信誉
  积累**的正常过程（EV 证书才即时通过）；
- 信誉提升要素：持续用同一证书签名、保持下载量与正版率、固定发布者名称；
- 通常数个版本/一定下载量后，SmartScreen 不再拦截。

---

## 五、常见问题

| 问题 | 处理 |
|------|------|
| 构建报 `Invoke-TrustedSigning: The user, group or application does not have permission` | 检查 IAM 角色分配是否给了 SP，且是 *Signer* 而非 Reader |
| 报 `CertificateProfile ... not found` | 检查账户名/Profile 名大小写与区域端点是否一致（Profile 与账户必须在同一区域） |
| 报认证失败 | 确认三个环境变量已设置、客户端密码未过期 |
| 想用托管身份（CI 的 VM 上）| 用 Azure VM/Function 托管身份替代 SP，无需密码 |

---

## 六、TASKS 状态更新

完成后：
- [ ] 本机 `Invoke-TrustedSigning` 验证通过
- [ ] electron-builder.yml 取消注释并填入实际值
- [ ] `npm run installer` 产出**已签名**安装包
- [ ] `Get-AuthenticodeSignature` = Valid
- [ ] TASKS.md T-023 标记完成
