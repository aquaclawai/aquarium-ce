<div align="center">

# 🐠 Aquarium CE

### 自托管 AI 智能体管理平台

一行命令即可部署、编排和管理 AI 智能体实例。

[![npm version](https://img.shields.io/npm/v/@aquaclawai/aquarium?color=cb3837&logo=npm)](https://www.npmjs.com/package/@aquaclawai/aquarium)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-required-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![GitHub Stars](https://img.shields.io/github/stars/aquaclawai/aquarium-ce?style=social)](https://github.com/aquaclawai/aquarium-ce)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**[官网](https://www.aquaclaw.ai)** · **[文档](docs/getting-started.md)** · **[贡献指南](CONTRIBUTING.md)** · **[English](README.md)**

</div>

---

## 快速开始

```bash
npx @aquaclawai/aquarium
```

打开 **http://localhost:3001** — 搞定。

## 为什么选择 Aquarium？

大多数 AI 智能体平台将你绑定在他们的云上。Aquarium 给你**完全的掌控权** — 在你自己的机器上运行，你的数据你做主。

- **一行命令启动** — 无需配置文件、环境变量或安装向导
- **数据完全自主** — SQLite 本地存储，零遥测数据收集
- **任意模型供应商** — 通过统一接口接入 27+ AI 供应商
- **生产级消息渠道** — 将智能体部署到 WhatsApp、Telegram、Discord、Slack 等 14+ 平台

## 功能特性

| 功能 | 说明 |
|---|---|
| **零配置启动** | SQLite 数据库自动创建，开箱即用 |
| **27+ AI 供应商** | OpenAI、Anthropic、Google、Mistral、DeepSeek 等 |
| **实例管理** | 创建、启动、停止、配置和监控智能体实例 |
| **内置对话** | 流式响应 + Markdown 渲染的聊天界面 |
| **模板市场** | 预配置的智能体模板，快速上手 |
| **14 个消息渠道** | WhatsApp、Telegram、Discord、Slack、LINE、Messenger 等 |
| **MCP 工具支持** | 通过 Model Context Protocol 扩展智能体能力 |
| **凭证保险库** | API 密钥和密钥的加密存储 |
| **健康监控** | 实时状态追踪与自动恢复 |
| **多语言界面** | 支持中文、英文、法文、德文、西班牙文、意大利文 |

## 系统架构

```
┌─────────────────────────────────────────────┐
│              Aquarium CE                     │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ React UI │  │ Express  │  │  SQLite   │ │
│  │ (Vite)   │◄─┤ 后端服务  ├──┤  数据库   │ │
│  └──────────┘  └────┬─────┘  └───────────┘ │
│                     │                       │
│         ┌───────────┼───────────┐           │
│         ▼           ▼           ▼           │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│    │ 智能体1  │ │ 智能体2  │ │ 智能体N  │     │
│    │(Docker) │ │(Docker) │ │(Docker) │     │
│    └─────────┘ └─────────┘ └─────────┘     │
└─────────────────────────────────────────────┘
```

## 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | 22+ |
| Docker | 建议最新版 |

## 文档

- **[快速上手](docs/getting-started.md)** — 安装与入门
- **[系统架构](docs/architecture.md)** — 设计理念与数据流
- **[配置说明](docs/configuration.md)** — CLI 参数与环境变量
- **[开发指南](docs/development.md)** — 参与项目开发

## CLI 参数

```bash
npx @aquaclawai/aquarium --port 8080       # 自定义端口
npx @aquaclawai/aquarium --host 0.0.0.0    # 对外暴露服务
npx @aquaclawai/aquarium --data-dir ./data  # 自定义数据目录
npx @aquaclawai/aquarium --open             # 自动打开浏览器
```

## 参与贡献

欢迎参与贡献！请查看 **[CONTRIBUTING.md](CONTRIBUTING.md)** 了解详情。

本项目包含 [AI 辅助开发技能](.agents/skills/)，助你使用 Claude Code 等工具高效贡献代码。

## 开源许可

[Apache 2.0](LICENSE) — 商用、个人使用均可。

---

<div align="center">

**[aquaclaw.ai](https://www.aquaclaw.ai)** — 我们的官网完全由 CAT（Citronetic Autonomous Technician）管理，这是一个运行在 Aquarium 平台上的 AI 智能体。

</div>
