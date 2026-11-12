cmake_minimum_required(VERSION 3.24)
project(NZISSpravki VERSION 1.0.12 LANGUAGES CXX)
set(APP_NAME "NHIS Checker")
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
option(NHIS_WEBVIEW2_PREVIEW "Build the Windows WebView2 preview" OFF)

if(APPLE AND NOT TARGET WrapOpenGL::WrapOpenGL)
    # Qt 6.8's OpenGL wrapper links AGL, which the macOS 26 SDK removed.
    find_package(OpenGL REQUIRED)
    add_library(WrapOpenGL::WrapOpenGL INTERFACE IMPORTED)
    target_link_libraries(WrapOpenGL::WrapOpenGL INTERFACE OpenGL::GL)
endif()

find_package(Qt6 6.6 REQUIRED COMPONENTS Widgets Network Xml)
find_package(OpenSSL 3 REQUIRED COMPONENTS Crypto)
find_package(LibXml2 REQUIRED)
find_path(LIBP11_INCLUDE_DIR NAMES libp11.h REQUIRED)
find_library(LIBP11_LIBRARY NAMES p11 libp11 REQUIRED)

add_library(nzis_protocol STATIC app/protocol.cpp app/xml_signature.cpp app/certificate.cpp)
target_compile_definitions(nzis_protocol PUBLIC APP_VERSION="${PROJECT_VERSION}")
target_include_directories(nzis_protocol PUBLIC app)
target_link_libraries(nzis_protocol PUBLIC Qt6::Xml OpenSSL::Crypto LibXml2::LibXml2)

add_executable(NZISSpravki MACOSX_BUNDLE WIN32
    app/main.cpp app/desktop.cpp app/ui.cpp app/nhis.cpp app/signing.cpp)
set_target_properties(NZISSpravki PROPERTIES OUTPUT_NAME "${APP_NAME}")
target_compile_definitions(NZISSpravki PRIVATE APP_NAME="${APP_NAME}")
target_include_directories(NZISSpravki PRIVATE "${LIBP11_INCLUDE_DIR}")
target_link_libraries(NZISSpravki PRIVATE nzis_protocol Qt6::Widgets Qt6::Network "${LIBP11_LIBRARY}")
if(MSVC)
    target_compile_options(nzis_protocol PUBLIC /utf-8)
endif()
if(WIN32)
    set(APP_ICON "${CMAKE_CURRENT_SOURCE_DIR}/app/assets/NHIS-Checker.ico")
    configure_file(app/windows.rc.in "${CMAKE_CURRENT_BINARY_DIR}/windows.rc" @ONLY)
    target_sources(NZISSpravki PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/windows.rc")
endif()

if(APPLE)
    enable_language(OBJCXX)
    set_property(TARGET NZISSpravki PROPERTY OBJCXX_STANDARD 20)
    target_sources(NZISSpravki PRIVATE app/browser_mac.mm app/assets/NZIS.icns)
    set_source_files_properties(app/browser_mac.mm PROPERTIES COMPILE_OPTIONS "-fobjc-arc")
    set_source_files_properties(app/assets/NZIS.icns PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
    target_link_libraries(NZISSpravki PRIVATE "-framework AppKit" "-framework WebKit")
    set_target_properties(NZISSpravki PROPERTIES
        MACOSX_BUNDLE_GUI_IDENTIFIER bg.nzis.spravki
        MACOSX_BUNDLE_BUNDLE_NAME "${APP_NAME}"
        MACOSX_BUNDLE_ICON_FILE NZIS.icns
        MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
        MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}")
elseif(WIN32 AND NHIS_WEBVIEW2_PREVIEW)
    set(WEBVIEW2_SDK_DIR "" CACHE PATH "Extracted Microsoft.Web.WebView2 NuGet package")
    set(WEBVIEW2_NATIVE_DIR "${WEBVIEW2_SDK_DIR}/build/native")
    if(NOT EXISTS "${WEBVIEW2_NATIVE_DIR}/include/WebView2.h" OR
       NOT EXISTS "${WEBVIEW2_NATIVE_DIR}/x64/WebView2Loader.dll.lib")
        message(FATAL_ERROR "Set WEBVIEW2_SDK_DIR to the extracted Microsoft.Web.WebView2 SDK for the Windows x64 preview.")
    endif()
    target_compile_definitions(NZISSpravki PRIVATE NHIS_WEBVIEW2_PREVIEW)
    target_sources(NZISSpravki PRIVATE app/browser_webview2.cpp)
    target_include_directories(NZISSpravki PRIVATE "${WEBVIEW2_NATIVE_DIR}/include")
    target_link_libraries(NZISSpravki PRIVATE "${WEBVIEW2_NATIVE_DIR}/x64/WebView2Loader.dll.lib" ole32 shlwapi)
    install(FILES "${WEBVIEW2_NATIVE_DIR}/x64/WebView2Loader.dll" DESTINATION .)
    install(FILES "${WEBVIEW2_SDK_DIR}/LICENSE.txt" DESTINATION licenses RENAME webview2-sdk.txt)
else()
    find_package(Qt6 6.6 REQUIRED COMPONENTS WebEngineWidgets WebChannel)
    target_sources(NZISSpravki PRIVATE app/browser_qt.cpp)
    target_link_libraries(NZISSpravki PRIVATE Qt6::WebEngineWidgets Qt6::WebChannel)
endif()

file(GLOB TOOTH_ASSETS CONFIGURE_DEPENDS RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}" "app/ui/teeth/*.svg")
set(UI_RESOURCES
    app/ui/index.html app/ui/styles.css app/ui/layout.js app/ui/odontogram.js
    app/ui/treatments.js app/ui/bridge.js app/ui/notifications.js app/ui/lookups.js app/ui/settings.js app/ui/xml-response.js app/ui/nomenclatures.json
    app/ui/status/done.svg app/ui/status/cancelled.svg app/ui/status/pending.svg app/ui/status/unknown.svg
    ${TOOTH_ASSETS})
qt_add_resources(NZISSpravki desktop PREFIX "/" FILES ${UI_RESOURCES})
install(TARGETS NZISSpravki BUNDLE DESTINATION . RUNTIME DESTINATION .)

include(CTest)
if(BUILD_TESTING)
    add_executable(nzis_protocol_test tests/protocol_signature.cpp)
    target_link_libraries(nzis_protocol_test PRIVATE nzis_protocol)
    add_test(NAME protocol_signature COMMAND nzis_protocol_test)
    add_executable(nzis_ui_test tests/ui_resources.cpp app/ui.cpp)
    target_compile_definitions(nzis_ui_test PRIVATE APP_NAME="${APP_NAME}")
    target_link_libraries(nzis_ui_test PRIVATE Qt6::Widgets)
    qt_add_resources(nzis_ui_test desktop_test PREFIX "/" FILES ${UI_RESOURCES})
    add_test(NAME bundled_ui COMMAND nzis_ui_test)
endif()
