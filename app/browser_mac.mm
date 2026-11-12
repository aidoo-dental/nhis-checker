#include "browser.h"
#include <QAction>
#include <QJsonDocument>
#include <QKeySequence>
#include <QMainWindow>
#include <QMenu>
#include <QMenuBar>
#include <QWidget>
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

@interface DesktopMessages : NSObject <WKScriptMessageHandler, WKNavigationDelegate> {
@public
    DesktopHandler handler;
}
@end

@implementation DesktopMessages
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (!message.frameInfo.isMainFrame || ![message.body isKindOfClass:[NSString class]]) return;
    auto request = QJsonDocument::fromJson(QByteArray([(NSString *)message.body UTF8String])).object();
    const auto id = request.value("id").toInt();
    if (id <= 0) return;
    const auto result = handler(request.value("action").toString(), request.value("data").toObject());
    const auto payload = QJsonDocument(result).toJson(QJsonDocument::Compact).toBase64();
    const auto reply = QStringLiteral("window.nzDesktopReply(%1,'%2')").arg(id).arg(QString::fromLatin1(payload));
    [message.webView evaluateJavaScript:[NSString stringWithUTF8String:reply.toUtf8().constData()] completionHandler:nil];
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSString *url = action.request.URL.absoluteString;
    decisionHandler(([url isEqualToString:@"about:blank"] || [url hasPrefix:@"about:blank#"])
        ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
@end

class BrowserWidget final : public QWidget {
    WKWebView *view;
    DesktopMessages *messages;
public:
    BrowserWidget(const QString &html, DesktopHandler handler) {
        setAttribute(Qt::WA_NativeWindow);
        auto *parentView = (__bridge NSView *)reinterpret_cast<void *>(winId());
        auto *configuration = [WKWebViewConfiguration new];
        configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = NO;
        messages = [DesktopMessages new];
        messages->handler = std::move(handler);
        [configuration.userContentController addScriptMessageHandler:messages name:@"nzis"];
        view = [[WKWebView alloc] initWithFrame:parentView.bounds configuration:configuration];
        view.navigationDelegate = messages;
        view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [parentView addSubview:view];
        [view loadHTMLString:[NSString stringWithUTF8String:html.toUtf8().constData()] baseURL:nil];
    }
    ~BrowserWidget() override {
        [view.configuration.userContentController removeScriptMessageHandlerForName:@"nzis"];
        view.navigationDelegate = nil;
        [view removeFromSuperview];
    }
};
QWidget *createBrowser(const QString &html, DesktopHandler handler) {
    return new BrowserWidget(html, std::move(handler));
}

void addBrowserEditMenu(QMainWindow &window) {
    auto *menuBar = window.menuBar();
    menuBar->setNativeMenuBar(true);
    auto *edit = menuBar->addMenu(QStringLiteral("Редактиране"));
    const auto addAction = [edit](const QString &label, QKeySequence::StandardKey shortcut, SEL command) {
        auto *action = edit->addAction(label);
        action->setShortcuts(shortcut);
        QObject::connect(action, &QAction::triggered, action, [command] {
            [NSApp sendAction:command to:nil from:nil];
        });
    };
    addAction(QStringLiteral("Изрежи"), QKeySequence::Cut, @selector(cut:));
    addAction(QStringLiteral("Копирай"), QKeySequence::Copy, @selector(copy:));
    addAction(QStringLiteral("Постави"), QKeySequence::Paste, @selector(paste:));
    addAction(QStringLiteral("Избери всичко"), QKeySequence::SelectAll, @selector(selectAll:));
}
