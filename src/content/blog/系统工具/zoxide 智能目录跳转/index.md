---
title: "zoxide：让 cd 成为过去式的智能目录跳转工具"
description: "基于 frecency 算法的 Rust 实现，一句话完成目录跳转，支持交互式选择"
pubDate: 2026-08-12
tags: ["zoxide", "CLI", "终端"]
category: "系统工具"
draft: false
visibility: "public"
cover: "./cover.png"
---

## 背景：为什么还需要一个 cd 替代品

`cd` 是终端里使用频率最高的命令之一，但它的体验几十年没变过：要么手敲完整路径，要么依赖 `Tab` 补全一级一级地点下去。深一点的目录树，跳转成本会指数级上升。

前人做过不少尝试：

- **autojump**（2009）：引入 `j` 命令，根据使用频率跳转目录；
- **z**（2011）：在 autojump 基础上改进，用 **frecency**（frequency + recency，频率与最近度加权）算法排序，是社区事实标准；
- **fasd**、**z.lua** 等：各种语言实现的变体。

**zoxide** 是这条线的集大成者：用 Rust 重写，速度更快（启动零开销、查询毫秒级），安装即插即用，支持 bash / zsh / fish / PowerShell / nushell 等几乎所有主流 shell，还内置了交互式选择模式。

## 工作原理

zoxide 会在后台维护一份「目录 → 分数」的数据库（默认存在 `~/.local/share/zoxide/`）。

每次跳转到一个目录，它的分数就会增加。分数由两部分构成：

- **recency（最近度）**：越近访问过，权重越高；
- **frequency（频率）**：访问次数越多，权重越高。

查询时 zoxide 对候选目录按分数排序，取最高者。所以 `z doc` 会跳转到你**最常去**的那个 `doc` 目录，而不是第一个匹配的。

## 安装

### macOS（Homebrew）

```bash
brew install zoxide
```

### Linux 常见发行版

```bash
# Debian / Ubuntu
sudo apt install zoxide

# Arch Linux
sudo pacman -S zoxide

# Fedora
sudo dnf install zoxide
```

### Windows

```bash
# Scoop
scoop install zoxide

# winget
winget install ajeetdsouza.zoxide
```

### 其他方式

- **Rust 开发者**：`cargo install zoxide`
- **官方一键脚本**（自动适配平台）：

```bash
curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
```

## 初始化 shell

安装后还不能直接用，需要在 shell 配置里加一行初始化（本质是注册 `z` 为函数并绑定补全）。

### zsh（`~/.zshrc`）

```bash
eval "$(zoxide init zsh)"
```

### bash（`~/.bashrc`）

```bash
eval "$(zoxide init bash)"
```

### fish（`~/.config/fish/config.fish`）

```fish
zoxide init fish | source
```

### PowerShell（PowerShell Profile）

```powershell
Invoke-Expression (zoxide init powershell)
```

改完配置记得 `source ~/.zshrc`（或重开终端）。

## 日常使用

假设你经常出入这些目录：

```text
~/projects/blog
~/projects/blog/src/content
~/work/archive
~/Downloads
```

### 基础跳转

```bash
z blog          # 跳转到 ~/projects/blog
z blog src      # 支持多参数：跳转到同时匹配 blog 和 src 的目录
z src           # 如果你最常去 ~/projects/blog/src/content，它会优先跳这里
```

### 回到之前的目录

```bash
z -             # 类似 cd -，回到上一个目录
```

### 交互式选择

同一关键字匹配多个目录时，与其猜，不如直接选：

```bash
zi              # 弹出选择列表（依赖 fzf / skim），方向键选择，回车跳转
zi src          # 也可以带关键字过滤
```

### 查询而不跳转

```bash
zq blog         # 打印匹配到的目录路径，但不跳转（方便在脚本里用）
```

### 管理数据库

```bash
z --list        # 列出所有记录的目录及分数
z --remove blog # 从数据库移除指定目录
z --clean       # 清理已不存在的目录
```

### 与 `cd` 无缝衔接

忘加初始化、或者临时想用原生 cd 的场景，zoxide 也提供了 `zoxide query` / `zoxide add` 等子命令。核心记忆点只有一个：**`z` 跳转、`zi` 选择、`zq` 查询**。

## 搭配建议

1. **配合 fzf**：`zi` 的选择界面就是 fzf，体验接近 IDE 的「最近打开」；
2. **配合编辑器**：Vim / Neovim 的 `:cd` 也可以接 zoxide（如 `vim-zoxide` 插件）；
3. **替换 `cd` 习惯**：把肌肉记忆从 `cd <完整路径>` 改成 `z <关键字>`，一周后基本回不去。

## 参考

- [zoxide GitHub 仓库](https://github.com/ajeetdsouza/zoxide)
- [fzf（交互式选择依赖）](https://github.com/junegunn/fzf)
