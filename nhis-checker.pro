TEMPLATE = app
TARGET = "NHIS Checker"
VERSION = 1.0.12
QT += widgets network xml
CONFIG += c++20
# Octal space keeps this string a single argument for both moc and MSVC.
DEFINES += APP_VERSION=\\\"$$VERSION\\\" APP_NAME=\\\"NHIS\\040Checker\\\"
INCLUDEPATH += $$PWD/app
SOURCES += app/main.cpp app/desktop.cpp app/ui.cpp app/nhis.cpp \
    app/signing.cpp app/protocol.cpp app/xml_signature.cpp app/certificate.cpp
HEADERS += app/browser.h app/certificate.h app/desktop.h app/error.h \
    app/nhis.h app/protocol.h app/signing.h app/xml_signature.h
RESOURCES += app/desktop.qrc
# These scripts run in Chromium, not the QML engine. Keep their source in
# the resource bundle even when Qt Creator enables the Qt Quick compiler.
QTQUICK_COMPILER_SKIPPED_RESOURCES += app/desktop.qrc

win32 {
    !msvc: error("Use the Qt 6.8.3 MSVC 2022 64-bit kit")
    QMAKE_CXXFLAGS += /utf-8
    CONFIG += windows
    CONFIG -= console
    RC_ICONS = app/assets/NHIS-Checker.ico
    QMAKE_TARGET_COMPANY = AIDOO
    QMAKE_TARGET_DESCRIPTION = NHIS Checker
    QMAKE_TARGET_PRODUCT = NHIS Checker
    # Optional, untracked overrides for another workstation.
    exists(local.pri): include(local.pri)
    isEmpty(OPENSSL_ROOT): OPENSSL_ROOT = $$clean_path($$PWD/../Qt/Tools/OpenSSLv3/Win_x64)
    isEmpty(LIBXML2_ROOT): LIBXML2_ROOT = $$clean_path($$PWD/../ThirdParty)
    isEmpty(LIBP11_ROOT): LIBP11_ROOT = $$clean_path($$PWD/../libp11-libp11-0.4.18/src)
    isEmpty(LIBXML2_DLL): LIBXML2_DLL = $$clean_path($$PWD/../unibackup/dependencies/bin/libxml2.dll)
    !exists($$OPENSSL_ROOT/include/openssl/evp.h): error("Set OPENSSL_ROOT in local.pri to OpenSSL 3 x64")
    !exists($$LIBXML2_ROOT/include/libxml/parser.h): error("Set LIBXML2_ROOT in local.pri")
    !exists($$LIBP11_ROOT/libp11.lib): error("Set LIBP11_ROOT in local.pri to a built libp11 x64 directory")
    INCLUDEPATH += $$OPENSSL_ROOT/include $$LIBXML2_ROOT/include $$LIBP11_ROOT
    LIBS += $$quote($$OPENSSL_ROOT/lib/libcrypto.lib) \
        $$quote($$LIBXML2_ROOT/dependencies/lib/libxml2.lib) \
        $$quote($$LIBP11_ROOT/libp11.lib)
    CONFIG(debug, debug|release): DEPLOY_CONFIG = debug
    else: DEPLOY_CONFIG = release
    isEmpty(DESTDIR): DESTDIR = $$OUT_PWD/$$DEPLOY_CONFIG
    DEPLOY_DIR = $$absolute_path($$DESTDIR, $$OUT_PWD)
    QMAKE_POST_LINK += powershell.exe -NoProfile -ExecutionPolicy Bypass -File $$shell_quote($$shell_path($$PWD/scripts/deploy-development.ps1)) \
        -BinaryDir $$shell_quote($$shell_path($$DEPLOY_DIR)) \
        -QtDir $$shell_quote($$shell_path($$[QT_INSTALL_PREFIX])) \
        -OpenSslRoot $$shell_quote($$shell_path($$OPENSSL_ROOT)) \
        -LibP11Root $$shell_quote($$shell_path($$LIBP11_ROOT)) \
        -LibXml2Dll $$shell_quote($$shell_path($$LIBXML2_DLL)) -Configuration $$DEPLOY_CONFIG
} else {
    CONFIG += link_pkgconfig
    PKGCONFIG += openssl libxml-2.0 libp11
}

macx {
    OBJECTIVE_SOURCES += app/browser_mac.mm
    QMAKE_OBJECTIVE_CXXFLAGS += -fobjc-arc
    LIBS += -framework AppKit -framework WebKit
    ICON = app/assets/NZIS.icns
} else {
    !qtHaveModule(webenginewidgets): error("Install Qt WebEngine for this Qt kit using Qt Maintenance Tool")
    !qtHaveModule(webchannel): error("Install Qt WebChannel for this Qt kit using Qt Maintenance Tool")
    QT += webenginewidgets webchannel
    SOURCES += app/browser_qt.cpp
}
