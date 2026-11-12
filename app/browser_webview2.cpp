#include "browser.h"
#include <QDebug>
#include <QDir>
#include <QHideEvent>
#include <QJsonDocument>
#include <QLabel>
#include <QPointer>
#include <QResizeEvent>
#include <QShowEvent>
#include <QStandardPaths>
#include <QTimer>
#include <QVBoxLayout>
#include <QWidget>
#include <windows.h>
#include <shlwapi.h>
#include <WebView2.h>
#include <wrl.h>

namespace {
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

constexpr wchar_t pageUrl[] = L"https://nhis-checker.invalid/index.html";

bool isAppDocument(const QString &uri) {
    const auto page = QString::fromWCharArray(pageUrl);
    return uri == page || uri == page + "#status" || uri == page + "#treatments";
}

void check(HRESULT result) {
    if (FAILED(result)) throw result;
}

QString readString(auto get) {
    LPWSTR value = nullptr;
    const auto result = get(&value);
    const auto text = SUCCEEDED(result) && value ? QString::fromWCharArray(value) : QString();
    CoTaskMemFree(value);
    return text;
}

class BrowserWidget final : public QWidget {
    const QByteArray html;
    const DesktopHandler handler;
    QLabel *status;
    bool comInitialized = false;
    bool ready = false;
    UINT64 pageNavigation = 0;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> view;

public:
    BrowserWidget(const QString &content, DesktopHandler dispatch)
        : html(content.toUtf8()), handler(std::move(dispatch)),
          status(new QLabel(QStringLiteral("Зареждане на NHIS Checker…"), this)) {
        setAttribute(Qt::WA_NativeWindow);
        setFocusPolicy(Qt::StrongFocus);
        status->setAlignment(Qt::AlignCenter);
        status->setWordWrap(true);
        status->setTextInteractionFlags(Qt::TextSelectableByMouse);
        auto *layout = new QVBoxLayout(this);
        layout->addWidget(status);
        QTimer::singleShot(0, this, [this] { initialize(); });
    }

    ~BrowserWidget() override {
        closeView();
        environment.Reset();
        if (comInitialized) CoUninitialize();
    }

protected:
    void resizeEvent(QResizeEvent *event) override {
        QWidget::resizeEvent(event);
        syncBounds();
    }

    void showEvent(QShowEvent *event) override {
        QWidget::showEvent(event);
        syncBounds();
        if (controller && ready) controller->put_IsVisible(TRUE);
    }

    void hideEvent(QHideEvent *event) override {
        if (controller) controller->put_IsVisible(FALSE);
        QWidget::hideEvent(event);
    }

    void focusInEvent(QFocusEvent *event) override {
        QWidget::focusInEvent(event);
        if (controller && ready) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    }

    bool event(QEvent *event) override {
        const bool handled = QWidget::event(event);
        if (event->type() == QEvent::DevicePixelRatioChange) syncBounds();
        return handled;
    }

    bool eventFilter(QObject *object, QEvent *event) override {
        if (controller && object == window() && event->type() == QEvent::Move)
            controller->NotifyParentWindowPositionChanged();
        return QWidget::eventFilter(object, event);
    }

private:
    HWND hwnd() { return reinterpret_cast<HWND>(winId()); }

    void syncBounds() {
        RECT bounds{};
        if (controller && GetClientRect(hwnd(), &bounds)) controller->put_Bounds(bounds);
    }

    void closeView() {
        ready = false;
        if (controller) controller->Close();
        view.Reset();
        controller.Reset();
    }

    void showFailure(HRESULT result) {
        qWarning("WebView2 initialization or renderer failure (HRESULT 0x%08lx)", static_cast<unsigned long>(result));
        closeView();
        if (result == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) {
            status->setText(QStringLiteral("Липсва Microsoft Edge WebView2 Runtime.\n"
                                           "Инсталирай го през инсталатора на NHIS Checker."));
        } else {
            status->setText(QStringLiteral("Интерфейсът не можа да се зареди (WebView2, 0x%1).\n"
                                           "Стартирай приложението отново. Ако проблемът продължи, обнови WebView2 Runtime.")
                                .arg(static_cast<quint32>(result), 8, 16, QLatin1Char('0')));
        }
        status->show();
    }

    void initialize() {
        try {
            check(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED));
            comInitialized = true;
            window()->installEventFilter(this);
            const auto folder = QDir::toNativeSeparators(
                QStandardPaths::writableLocation(QStandardPaths::CacheLocation) + "/WebView2").toStdWString();
            const QPointer<BrowserWidget> self(this);
            check(CreateCoreWebView2EnvironmentWithOptions(nullptr, folder.c_str(), nullptr,
                Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                    [self](HRESULT result, ICoreWebView2Environment *environment) {
                        if (self) self->createController(result, environment);
                        return S_OK;
                    }).Get()));
        } catch (HRESULT result) {
            showFailure(result);
        }
    }

    void createController(HRESULT result, ICoreWebView2Environment *createdEnvironment) {
        try {
            check(result);
            environment = createdEnvironment;
            ComPtr<ICoreWebView2Environment10> withOptions;
            check(environment.As(&withOptions));
            ComPtr<ICoreWebView2ControllerOptions> options;
            check(withOptions->CreateCoreWebView2ControllerOptions(&options));
            check(options->put_IsInPrivateModeEnabled(TRUE));
            const QPointer<BrowserWidget> self(this);
            check(withOptions->CreateCoreWebView2ControllerWithOptions(hwnd(), options.Get(),
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [self](HRESULT result, ICoreWebView2Controller *controller) {
                        if (self) self->loadPage(result, controller);
                        else if (controller) controller->Close();
                        return S_OK;
                    }).Get()));
        } catch (HRESULT error) {
            showFailure(error);
        }
    }

    void loadPage(HRESULT result, ICoreWebView2Controller *createdController) {
        try {
            check(result);
            controller = createdController;
            check(controller->put_IsVisible(FALSE));
            check(controller->get_CoreWebView2(&view));
            configureSettings();
            configureNavigation();
            configureResources();
            EventRegistrationToken token{};
            check(view->add_WebMessageReceived(
                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                    [this](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) {
                        receiveMessage(args);
                        return S_OK;
                    }).Get(), &token));
            syncBounds();
            check(view->Navigate(pageUrl));
        } catch (HRESULT error) {
            showFailure(error);
        }
    }

    void configureSettings() {
        ComPtr<ICoreWebView2Settings> settings;
        check(view->get_Settings(&settings));
        check(settings->put_AreHostObjectsAllowed(FALSE));
        check(settings->put_AreDevToolsEnabled(FALSE));
        check(settings->put_AreDefaultContextMenusEnabled(FALSE));
        check(settings->put_AreDefaultScriptDialogsEnabled(FALSE));
        check(settings->put_IsStatusBarEnabled(FALSE));
        ComPtr<ICoreWebView2Settings3> shortcuts;
        check(settings.As(&shortcuts));
        // Editing shortcuts (Ctrl+C, Ctrl+V, Ctrl+A) still go to the page.
        check(shortcuts->put_AreBrowserAcceleratorKeysEnabled(FALSE));
        ComPtr<ICoreWebView2Settings4> autofill;
        check(settings.As(&autofill));
        check(autofill->put_IsPasswordAutosaveEnabled(FALSE));
        check(autofill->put_IsGeneralAutofillEnabled(FALSE));

        ComPtr<ICoreWebView2Controller4> dragDrop;
        check(controller.As(&dragDrop));
        check(dragDrop->put_AllowExternalDrop(FALSE));
    }

    void configureNavigation() {
        EventRegistrationToken token{};
        check(view->add_NavigationStarting(
            Callback<ICoreWebView2NavigationStartingEventHandler>(
                [this](ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *args) {
                    if (!isAppDocument(readString([args](LPWSTR *uri) { return args->get_Uri(uri); })))
                        return args->put_Cancel(TRUE);
                    return args->get_NavigationId(&pageNavigation);
                }).Get(), &token));
        check(view->add_FrameNavigationStarting(
            Callback<ICoreWebView2NavigationStartingEventHandler>(
                [](ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *args) {
                    return args->put_Cancel(TRUE);
                }).Get(), &token));
        check(view->add_NewWindowRequested(
            Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                [](ICoreWebView2 *, ICoreWebView2NewWindowRequestedEventArgs *args) {
                    return args->put_Handled(TRUE);
                }).Get(), &token));
        check(view->add_PermissionRequested(
            Callback<ICoreWebView2PermissionRequestedEventHandler>(
                [](ICoreWebView2 *, ICoreWebView2PermissionRequestedEventArgs *args) {
                    return args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
                }).Get(), &token));

        ComPtr<ICoreWebView2_4> downloads;
        check(view.As(&downloads));
        check(downloads->add_DownloadStarting(
            Callback<ICoreWebView2DownloadStartingEventHandler>(
                [](ICoreWebView2 *, ICoreWebView2DownloadStartingEventArgs *args) {
                    args->put_Handled(TRUE);
                    return args->put_Cancel(TRUE);
                }).Get(), &token));
        check(view->add_NavigationCompleted(
            Callback<ICoreWebView2NavigationCompletedEventHandler>(
                [this](ICoreWebView2 *, ICoreWebView2NavigationCompletedEventArgs *args) {
                    UINT64 navigation = 0;
                    if (FAILED(args->get_NavigationId(&navigation)) || navigation != pageNavigation) return S_OK;
                    BOOL success = FALSE;
                    args->get_IsSuccess(&success);
                    QMetaObject::invokeMethod(this, [this, success] {
                        if (!controller) return;
                        if (!success) {
                            showFailure(E_FAIL);
                            return;
                        }
                        ready = true;
                        status->hide();
                        syncBounds();
                        controller->put_IsVisible(isVisible());
                        if (hasFocus()) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                    }, Qt::QueuedConnection);
                    return S_OK;
                }).Get(), &token));
        check(view->add_ProcessFailed(
            Callback<ICoreWebView2ProcessFailedEventHandler>(
                [this](ICoreWebView2 *, ICoreWebView2ProcessFailedEventArgs *args) {
                    COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
                    if (SUCCEEDED(args->get_ProcessFailedKind(&kind)) &&
                        (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED ||
                         kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED)) {
                        QMetaObject::invokeMethod(this, [this] { showFailure(E_FAIL); }, Qt::QueuedConnection);
                    }
                    return S_OK;
                }).Get(), &token));
    }

    void configureResources() {
        // Serve the embedded document from memory at a reserved origin.
        // No HTTP listener or writable HTML files are needed.
        ComPtr<ICoreWebView2_22> resources;
        check(view.As(&resources));
        for (const auto pattern : {L"https://*", L"http://*"}) {
            check(resources->AddWebResourceRequestedFilterWithRequestSourceKinds(pattern,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL));
        }
        EventRegistrationToken token{};
        check(view->add_WebResourceRequested(
            Callback<ICoreWebView2WebResourceRequestedEventHandler>(
                [this](ICoreWebView2 *, ICoreWebView2WebResourceRequestedEventArgs *args) {
                    return serveResource(args);
                }).Get(), &token));
    }

    HRESULT serveResource(ICoreWebView2WebResourceRequestedEventArgs *args) {
        ComPtr<ICoreWebView2WebResourceRequest> request;
        const auto result = args->get_Request(&request);
        if (FAILED(result)) return result;
        const bool isPage = readString([&](LPWSTR *uri) { return request->get_Uri(uri); }) ==
                                QString::fromWCharArray(pageUrl) &&
                            readString([&](LPWSTR *method) { return request->get_Method(method); }) == "GET";
        ComPtr<IStream> body;
        if (isPage)
            body.Attach(SHCreateMemStream(reinterpret_cast<const BYTE *>(html.constData()), static_cast<UINT>(html.size())));
        ComPtr<ICoreWebView2WebResourceResponse> response;
        const auto created = environment->CreateWebResourceResponse(body.Get(), body ? 200 : 404,
            body ? L"OK" : L"Not Found",
            L"Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
            &response);
        return SUCCEEDED(created) ? args->put_Response(response.Get()) : created;
    }

    bool isCurrentPage() const {
        return view && isAppDocument(readString([this](LPWSTR *uri) { return view->get_Source(uri); }));
    }

    void receiveMessage(ICoreWebView2WebMessageReceivedEventArgs *args) {
        if (!isCurrentPage() ||
            !isAppDocument(readString([args](LPWSTR *source) { return args->get_Source(source); }))) return;
        const auto message = readString([args](LPWSTR *json) { return args->get_WebMessageAsJson(json); });
        if (message.size() > 1024 * 1024) return;
        const auto request = QJsonDocument::fromJson(message.toUtf8()).object();
        const auto id = request.value("id").toInt();
        const auto action = request.value("action").toString();
        if (id <= 0 || action.isEmpty() || !request.value("data").isObject()) return;
        // Native file/PIN dialogs and synchronous NHIS calls can run nested event loops.
        // Leave the WebView2 callback before dispatching to Desktop.
        QMetaObject::invokeMethod(this, [this, id, action, navigation = pageNavigation,
                                         data = request.value("data").toObject()] {
            if (navigation != pageNavigation || !isCurrentPage()) return;
            const QPointer<BrowserWidget> self(this);
            const auto dispatch = handler;
            const auto result = dispatch(action, data);
            if (!self || navigation != pageNavigation || !isCurrentPage()) return;
            const auto encoded = QJsonDocument(result).toJson(QJsonDocument::Compact).toBase64();
            const QJsonObject reply{{"id", id}, {"encoded", QString::fromLatin1(encoded)}};
            const auto json = QString::fromUtf8(QJsonDocument(reply).toJson(QJsonDocument::Compact)).toStdWString();
            const auto posted = view->PostWebMessageAsJson(json.c_str());
            if (FAILED(posted)) showFailure(posted);
        }, Qt::QueuedConnection);
    }
};
}

QWidget *createBrowser(const QString &html, DesktopHandler handler) {
    return new BrowserWidget(html, std::move(handler));
}
