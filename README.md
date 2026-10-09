# freehub2copilot

**The [free-model-hub](https://github.com/lfapex/free-model-hub) daemon's roster — free lane, Kilo, the 13 account channels, your relays — directly in GitHub Copilot Chat.**

A VS Code BYOK extension in the mechanism of
[anyfree2copilot](https://github.com/lfapex/anyfree2copilot):
`vscode.lm.registerLanguageModelChatProvider` plugs into the same provider API
Copilot Chat itself uses, so the hub's roster is grouped the way
[dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) groups
it — **OpenCode**, **Kilo**, **CodeArts Agent**, **ZCode (智谱)**,
**TRAE (字节)**, … — with each model named as the hub spells its id (no
`provider/` routing prefix). Agent mode, tool calling and MCP still come from Copilot. No custom-endpoint form to fill, no proxy
process per client: the hub daemon is the only server, this extension is one
of its clients (the other being [freehub2dsh](https://github.com/lfapex/freehub2dsh) for dsh).

## Getting started

### Prerequisites

- VS Code 1.116+ with GitHub Copilot Chat (the free Copilot tier works)
- The [free-model-hub](https://github.com/lfapex/free-model-hub) daemon
  installed and running on this machine:
  ```sh
  npm i -g github:lfapex/free-model-hub
  free-model-hub        # first boot prints the OpenAI endpoint + key
  ```

### Install

```sh
git clone https://github.com/lfapex/freehub2copilot.git
cd freehub2copilot
npm install && npm run compile && npm run package
code --install-extension dist/freehub2copilot-0.1.0.vsix
```

Open Copilot Chat, click the model picker. Models appear under their platform
section (**OpenCode**, **Kilo**, **CodeArts Agent**, …), each named exactly as
the hub spells the id — minus the `org/` routing prefix, since the section
heading already names the platform.

## Zero configuration

On the machine that runs the hub the extension needs **no settings at all**:

- the server key is read read-only from the hub's own data directory
  (`~/.free-model-hub/hub/settings.json`) — never echoed, never rewritten;
- the endpoint defaults to `http://127.0.0.1:8330`;
- the catalog re-reads every 5 minutes (`freehub.refreshSeconds`), so a
  channel login or a relay edit on the hub's settings page flows into the
  picker without touching VS Code;
- a down daemon is started from PATH (`free-model-hub`) on the zero-config
  host; the key is re-read after first boot mints it. If it still cannot
  come up, the last roster is kept instead of emptying the picker.

Settings exist for the remote-hub case: `freehub.baseUrl` / `freehub.apiKey`.

## What it maps

| Copilot part | Hub wire |
| --- | --- |
| text part | `delta.content` |
| thinking part (proposed API; silently dropped on runtimes without it) | `delta.reasoning` / `delta.reasoning_content` |
| tool-call part (index-accumulated, name-repeat safe) | `delta.tool_calls[]` |
| usage data part | the stream's final `usage` |
| images (only for models advertising vision) | `image_url` data URLs |

Known VS Code-side limitation (affects every BYOK extension): agent sessions
auto-restored during window startup can reject model switches with
`modelSelectionFailed` — start a new agent chat, or use the regular chat
panel ([microsoft/vscode#337742](https://github.com/microsoft/vscode/issues/337742)).

## Development

```sh
npm run smoke      # headless tests: key resolution, message conversion
npm run compile
npm run package    # -> dist/freehub2copilot-0.1.0.vsix
```

## Notes

- Model availability, quotas and terms belong to the hub's lanes
  (OpenCode Zen, Kilo, the 13 channels, your relays) — see the hub's README.
- Use at your own discretion and respect the terms of service of the upstreams.

## License

[MIT](LICENSE)
