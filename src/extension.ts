import { Executable, ExecutableOptions, LanguageClientOptions, LanguageClient, ReferencesRequest, NotificationType, MessageType } from 'vscode-languageclient';
import { languages, IndentAction, workspace, window, commands, ExtensionContext, Position, LanguageConfiguration, Uri, Command, } from "vscode";
import * as path from 'path';


export interface ScopeInfo {
  scope: "default" | "global" | "workspace" | "folder";
  configurationTarget: boolean;
}


interface ActionableMessage {
  severity: MessageType;
  message: string;
  data?: any;
  commands?: Command[];
}

namespace ActionableNotification {
  export const type = new NotificationType<ActionableMessage, void>('xml/actionableNotification');
}

export function activate(context: ExtensionContext) {
  let clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'xml' },
      { scheme: 'file', language: 'xsl' },
      { scheme: 'untitled', language: 'xml' },
      { scheme: 'untitled', language: 'xsl' }
    ]
  }

  let serverOptions = getServerExecutable();
  let languageClient = new LanguageClient('xml', 'XML Support', serverOptions, clientOptions);
  let toDispose = context.subscriptions;
  let disposable = languageClient.start();
  toDispose.push(disposable);
  languageClient.onReady().then(() => {
    context.subscriptions.push(commands.registerCommand(Commands.SHOW_REFERENCES, (uriString: string, position: Position) => {
      const uri = Uri.parse(uriString);
      workspace.openTextDocument(uri).then(document => {
        let param = languageClient.code2ProtocolConverter.asTextDocumentPositionParams(document, position);
        languageClient.sendRequest(ReferencesRequest.type, param).then(locations => {
          commands.executeCommand(Commands.EDITOR_SHOW_REFERENCES,
            uri,
            languageClient.protocol2CodeConverter.asPosition(position),
            locations.map(languageClient.protocol2CodeConverter.asLocation));
        })
      })
    }));

    setupNotificationListener(languageClient);

    context.subscriptions.push(commands.registerCommand(Commands.OPEN_SETTINGS, async (settingId?: string) => {
      commands.executeCommand(Commands.EDITOR_OPEN_SETTINGS, settingId);
    }));
  });
  languages.setLanguageConfiguration('xml', getIndentationRules());
  languages.setLanguageConfiguration('xsl', getIndentationRules());
}


function getIndentationRules(): LanguageConfiguration {
  return {
    // https://github.com/microsoft/vscode/blob/d00558037359acceea329e718036c19625f91a1a/extensions/html-language-features/client/src/htmlMain.ts#L114-L115
    indentationRules: {
      increaseIndentPattern: /<(?!\?|[^>]*\/>)([-_\.A-Za-z0-9]+)(?=\s|>)\b[^>]*>(?!.*<\/\1>)|<!--(?!.*-->)|\{[^}"']*$/,
      decreaseIndentPattern: /^\s*(<\/[-_\.A-Za-z0-9]+\b[^>]*>|-->|\})/
    },
    onEnterRules: [
      {
        beforeText: new RegExp(`<([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
        afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>/i,
        action: { indentAction: IndentAction.IndentOutdent }
      },
      {
        beforeText: new RegExp(`<(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
        action: { indentAction: IndentAction.Indent }
      }
    ]
  };
}

function setupNotificationListener(languageClient: LanguageClient): void {
  languageClient.onNotification(ActionableNotification.type, (notification: ActionableMessage) => {
    let show = null;
    switch (notification.severity) {
      case MessageType.Info:
        show = window.showInformationMessage;
        break;
      case MessageType.Warning:
        show = window.showWarningMessage;
        break;
      case MessageType.Error:
        show = window.showErrorMessage;
        break;
    }
    if (!show) {
      return;
    }
    const titles: string[] = notification.commands.map(a => a.title);
    show(notification.message, ...titles).then((selection) => {
      for (const action of notification.commands) {
        if (action.title === selection) {
          const args: any[] = (action.arguments) ? action.arguments : [];
          commands.executeCommand(action.command, ...args);
          break;
        }
      }
    });
  });
}


enum Commands {
  SHOW_REFERENCES = 'xml.show.references',
  EDITOR_SHOW_REFERENCES = 'editor.action.showReferences',
  OPEN_SETTINGS = 'xml.open.settings',
  EDITOR_OPEN_SETTINGS = "workbench.action.openSettings"
}


export function getServerExecutable(): Executable {
  let executable: Executable = Object.create(null);
  let options: ExecutableOptions = Object.create(null);
  options.env = process.env;
  options.stdio = 'pipe';
  executable.options = options;
  executable.command = "java"
  
  let config = workspace.getConfiguration().get<string>("xml.laguageServerPath")

  const serverPath = config === null || config === undefined ? path.join(__dirname, "server", "org.eclipse.lemminx-uber.jar") :  config
  
  executable.args = ["-Xmx64M", "-XX:+UseG1GC",
    "-XX:+UseStringDeduplication",
    "-cp",
    serverPath,
    "org.eclipse.lemminx.XMLServerLauncher"];

  return executable;
}