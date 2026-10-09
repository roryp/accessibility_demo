# Lab 0: Setup (10 min)

## You need

- **Node.js** 20.19+ or 22.12+ (`node --version`)
- A **GitHub Copilot** plan that includes HydraFusion: Pro, Pro+, Business or Enterprise. On Business and Enterprise, an admin must allow preview features.
- To be signed in to Copilot: `copilot login`, a GitHub CLI login (`gh auth login`), or a `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` environment variable

You don't need to install the Copilot CLI: the Node.js SDK ships the Copilot runtime as a platform package.

## Steps

```powershell
cd accessibility_demo
npm install
npm run setup    # installs the headless Chromium used by the accessibility tests
npm run reset    # copies starter/site → site
```

Check that everything works (free):

```powershell
npm run models
```

The last line should say **"✅ HydraFusion is ready"**. If it doesn't, see [Troubleshooting](../README.md#troubleshooting).

## What `npm install` gave you

| Package | Why |
| --- | --- |
| `@github/copilot-sdk` | Drives Copilot programmatically: sessions, tools, permissions and events. It includes the Copilot runtime. |
| `playwright` | Real Chromium for keyboard and focus testing |
| `@axe-core/playwright` | Industry-standard WCAG rule engine |

Next: [Lab 1: HydraFusion and Copilot pricing](01-hydrafusion-and-pricing.md)
