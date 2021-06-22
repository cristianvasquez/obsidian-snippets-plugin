import "./styles.scss";

var path = require('path');

// @ts-ignore
import extract from "./extract"

// @ts-ignore
import runner from "./runner"

// @ts-ignore
import DEFAULT from "./consts"

import {
    Plugin,
    PluginManifest,
    MarkdownView,
    App,
    Modal,
    Notice,
    PluginSettingTab,
    Setting,
} from "obsidian";


interface RunSnippetsSettings {
    variants: string;
}

const DEFAULT_SETTINGS: RunSnippetsSettings = {
    variants: DEFAULT.variants
}


export default class RunSnippets extends Plugin {
    constructor(app: App, pluginManifest: PluginManifest) {
        super(app, pluginManifest);
    }

    async loadSettings() {
        this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // This field stores your plugin settings.
    settings: RunSnippetsSettings;

    async onload() {

        console.log("Loading Snippets-plugin");
        await this.loadSettings();

        this.addSettingTab(new RunSnippetsSettingsTab(this.app, this));

        this.addCommand({
            id: "snippets-plugin",
            name: "Run",
            callback: () => this.runSnippet(),
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "Enter",
                },
            ],
        });

        this.registerInterval(
            window.setInterval(this.injectButtons.bind(this), 1000)
        );
    }

    injectButtons() {
        this.addRunButtons();
    }

    get_vars() {
        let active_view = app.workspace.getActiveViewOfType(MarkdownView);
        if (active_view == null) {
            return null;
        }

        let vaultPath = this.app.vault.adapter.basePath;
        let folder = active_view.file.parent.path;
        let fileName = active_view.file.name

        return {
            vault_path: vaultPath,
            folder: folder,
            file_name: fileName,
            file_path: path.join(vaultPath, folder, fileName),
            python: 'python3 -c'
        }
    }

    /**
     * Adds buttons for the preview mode
     */
    addRunButtons() {


        let vars = this.get_vars();

        if (!vars) return;
        
        let variants = this.settings.variants

        document.querySelectorAll("pre > code").forEach(function (codeBlock) {
            const pre = codeBlock.parentNode;
            let hasButton = pre.parentNode.classList.contains("has-run-button");

            // Already has a button
            if (hasButton) {
                return;
            }

            function definedVariant(classList, variants) {
                for (var key of Object.keys(variants)) {
                    if (classList.contains(`language-${key}`)) {
                        return key
                    }
                }
                return null

            }

            let lang = definedVariant(pre.classList, variants)

            // No variant defined for this language
            if (lang == null) {
                return;
            }
            // @ts-ignore
            let variant = variants[lang]

            // Not active in preview
            if (!variant.showRunButtonInPreview) {
                return;
            }

            pre.parentNode.classList.add("has-run-button");
            let button = document.createElement("button");
            button.className = "run-code-button";
            button.type = "button";
            button.innerText = "Run";

            let src = codeBlock.innerText;

            let command = apply_template(src, variant.template, vars)

            function runCommand(command: string) {
                const {exec} = require("child_process");
                button.innerText = "Running";
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`error: ${error.message}`);
                        if (variant.showModal) {
                            new Notice(error.message);
                        }
                        button.innerText = "error";
                        return;
                    }
                    if (stderr) {
                        console.error(`stderr: ${stderr}`);
                        if (variant.showModal) {
                            new Notice(stderr);
                        }
                        button.innerText = "error";
                        return;
                    }
                    console.debug(`stdout: ${stdout}`);

                    if (variant.showModal) {
                        new Notice(stdout);
                    }
                    button.innerText = "Run";
                });
            }

            button.addEventListener("click", function () {
                runCommand(command);
            });

            pre.appendChild(button);
        });
    }

    /**
     * rus a snippet, when the cursor is on top of it
     */
    runSnippet() {
        let vars = this.get_vars();

        if (!vars) return;
        
        let variants = this.settings.variants

        const view = this.app.workspace.activeLeaf.view;
        if (view instanceof MarkdownView) {

            const editor = view.sourceMode.cmEditor;

            let document = editor.getDoc().getValue()
            let line = editor.getCursor().line

            let match = extract(document, line, variants)

            if (match !== null) {
                let targetLine = match.end + 1
                let lang = match.lang
                // @ts-ignore
                let variant = variants[lang]
                let command = apply_template(match.text, variant.template, vars)

                const {exec} = require("child_process");
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`error: ${error.message}`);
                        if (variant.appendOutputContents) {
                            writeResult(editor, error, targetLine)
                        }
                        if (variant.showModal) {
                            new Notice(error.message);
                        }
                        return;
                    }
                    if (stderr) {
                        console.error(`stderr: ${stderr}`);
                        if (variant.appendOutputContents) {
                            writeResult(editor, stderr, targetLine)
                        }
                        if (variant.showModal) {
                            new Notice(stderr);
                        }
                        return;
                    }
                    console.debug(`stdout: ${stdout}`);
                    if (variant.appendOutputContents) {
                        writeResult(editor, stdout, targetLine)
                    }
                    if (variant.showModal) {
                        new Notice(stdout);
                    }
                });

            }
        }
    }
}

function writeResult(editor, result: string, outputLine: number) {

    let output = `\n\`\`\`output
${result}    
\`\`\`
`
    editor.getDoc().replaceRange(output, {line: outputLine, ch: 0});

}

function apply_template(src: string, template: string, vars: object) {
    let result = template.replace('{{src}}', src)
    result = result.replace('{{vault_path}}', vars.vault_path)
    result = result.replace('{{folder}}', vars.folder)
    result = result.replace('{{file_name}}', vars.file_name)
    result = result.replace('{{file_path}}', vars.file_path)
    return result
}


class RunSnippetsSettingsTab extends PluginSettingTab {
    plugin: RunSnippets;

    constructor(app: App, plugin: RunSnippets) {
        super(app, plugin);
        this.plugin = plugin;

    }

    display(): void {
        const {containerEl} = this;
        const settings = this.plugin.settings;
        containerEl.empty();

        this.containerEl.createEl("h3", {
            text: "Snippets",
        });


        new Setting(containerEl)
            .setName('Code fences')
            .setDesc('config for each language')
            .addTextArea(text => {
                    text
                        .setPlaceholder(JSON.stringify(DEFAULT.variants, null, 2))
                        .setValue(JSON.stringify(this.plugin.settings.variants, null, 2) || '')
                        .onChange(async (value) => {
                            try {
                                const newValue = JSON.parse(value);
                                this.plugin.settings.variants = newValue;
                                await this.plugin.saveSettings();
                            } catch (e) {
                                return false;
                            }
                        })
                    text.inputEl.rows = 12;
                    text.inputEl.cols = 60;
                }
            );

        this.containerEl.createEl("h4", {
            text: "This plugin is experimental",
        });

    }

}
