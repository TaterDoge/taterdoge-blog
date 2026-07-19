---
title: "MacOS下安装 HomeBrew以及软件的安装和备份"
description: "关于MacOS下包管理工具的安装和备份"
pubDate: 2024-11-30
tags: ["MacOS", "HomeBrew"]
category: "MacOS"
draft: false
visibility: "public"
cover: "./cover.png"
---

## 安装 HomeBrew

终端中执行下面的安装脚本-[**_脚本引用至知乎文章_**](https://zhuanlan.zhihu.com/p/111014448/)

安装：

```bash
/bin/zsh -c "$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/Homebrew.sh)"
```

卸载：

```bash
/bin/zsh -c "$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/HomebrewUninstall.sh)"
```

## 软件备份及恢复

基于[**brew bundle**](https://github.com/Homebrew/homebrew-bundle)实现, 它可以生成一个软件的安装列表

可以备份的软件以下类型:

1. brew tap 中的软件库
2. brew 安装的命令行工具
3. brew cask 安装的 App
4. Mac App Store 安装的 App
5. VScode 插件

上述列表中前三类软件可以直接备份和恢复, App Stroe 安装的软件需要额外安装 [**mas**](https://github.com/mas-cli/mas) 进行支持, VScode 插件不建议使用 HomeBrew 管理不过多赘述

如果需要使用 HomeBrew 备份和恢复 App Stroe 软件需要在备份前先对 mas 进行安装, HomeBrew 不自带这个软件

安装 mas:

```bash
brew install mas
```

详细的命令可以在终端中运行 mas help 查看

## 备份

```bash
brew bundle dump --describe --force --file="~/.config/Brewfile"
```

`--describe`：为列表中的命令行工具加上说明性文字。

`--force`：直接覆盖之前生成的 Brewfile 文件。如果没有该参数，会询问是否覆盖。

`--file="~/.config/Brewfile"`：在指定位置生成文件。如果没有该参数，则在当前目录生成 Brewfile 文件。

生成的文件如下(自用):

```bash
# 核心工具
brew "acsandmann/tap/rift"
brew "cocoapods"
brew "felixkratz/formulae/sketchybar"
brew "fd"
brew "fish"
brew "fzf"
brew "gh"
brew "jq"
brew "lazydocker"
brew "lazygit"
brew "lsd"
brew "mise"
brew "mole"
brew "neovim"
brew "ollama"
brew "pnpm"
brew "ripgrep"
brew "rtk"
brew "starship"
brew "tmux"
brew "tree-sitter-cli"
brew "uv"
brew "yazi"
brew "zoxide"
# 开发工具
cask "apifox"
cask "expo-orbit"
cask "figma"
cask "neovide-app"
cask "open-codesign"
cask "orbstack"
cask "raycast"
cask "wechatwebdevtools"
cask "xcodes-app"
# AI 工具
cask "lobehub"
cask "claude-code"
cask "codex-app"
# 通讯协作
cask "dingtalk"
cask "feishu"
cask "wechat"
cask "wechatwork"
# 终端工具
cask "kitty"
cask "warp"
# 输入法与语言
cask "font-maple-mono-nf-cn"
cask "input-source-pro"
cask "jackiexiao/tap/macvimswitch"
cask "easydict"
# 系统工具
cask "commandq"
cask "ping-island"
cask "thaw"
# 媒体与文件
cask "iina"
cask "qspace-pro"
# 其他
cask "chatgpt-atlas"
```

## 恢复

```bash
brew bundle --file="~/.config/Brewfile"
```
