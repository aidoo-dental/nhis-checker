# Компилиране на NHIS Checker

[← Начална страница](../README.md)

Всички команди се изпълняват от основната папка на проекта.

## Компилиране за macOS

Нужни са CMake, Ninja, Xcode и Qt 6.8 с двете архитектури. OpenSSL 3 и libp11 се компилират за всяка архитектура с минимална версия macOS 12.0. Приложението използва системната libxml2. [Qt за macOS](https://doc.qt.io/qt-6.8/macos.html)

```sh
qt_dir=/path/to/Qt/6.8.3/macos
sdk="$(xcrun --sdk macosx --show-sdk-path)"
for arch in arm64 x86_64; do
  deps="/path/to/deps/$arch"
  build="build-mac-$arch"
  cmake -S . -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="$arch" -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
    -DCMAKE_PREFIX_PATH="$qt_dir;$deps" -DOPENSSL_ROOT_DIR="$deps" \
    -DLIBP11_INCLUDE_DIR="$deps/include" -DLIBP11_LIBRARY="$deps/lib/libp11.dylib" \
    -DLIBXML2_INCLUDE_DIR="$sdk/usr/include/libxml2" -DLIBXML2_LIBRARY="$sdk/usr/lib/libxml2.tbd"
  cmake --build "$build"
  ctest --test-dir "$build" --output-on-failure
  scripts/package-macos.sh "$build" "$qt_dir"
done
```

Скриптът проверява архитектурата и минималната версия на macOS за всеки включен бинарен файл. Пакетите в `dist/` се именуват `NHIS Checker <версия> - Apple Silicon.dmg` и `NHIS Checker <версия> - Intel.dmg`, като версията се прочита от пакетираното приложение. Пробните пакети използват локален ad hoc подпис на приложението.

## Компилиране за Windows x64

Workflow-ът `.github/workflows/windows.yml` компилира с MSVC 2022, Qt 6.8.3, OpenSSL 3.5 LTS, libxml2 и libp11. Изпълнява протоколните тестове и проверява всички вградени ресурси, пакетира чрез Inno Setup 6, инсталира EXE файла и проверява реалния интерфейс, връзката с приложението, известията и журнала. Накрая проверява деинсталирането. Успешният push build на `main` качва пакет за подписване с тридневен срок. Подписаните инсталатори се публикуват в Releases.

Пакетиране след локално компилиране (PowerShell 7 в MSVC x64 среда):

```powershell
./scripts/package-windows.ps1 -BuildDir build-win -QtDir C:/Qt/6.8.3/msvc2022_64 -DepsDir C:/deps/x64 -LibP11Dir C:/deps/libp11
```

Резултат: `dist/NHIS Checker <версия> - Windows x64 Setup.exe`. Версията се прочита от компилирания EXE.

Нужни са MSVC 2022 x64, CMake, Qt 6 за MSVC с Qt WebEngine и Qt WebChannel, OpenSSL 3, libxml2 и libp11 за x64. Библиотеката libp11 може да се компилира с `nmake /f Makefile.mak OPENSSL_DIR=C:\OpenSSL-Win64 BUILD_FOR=WIN64` в x64 Native Tools Command Prompt. [Инструкции на libp11](https://github.com/OpenSC/libp11/blob/master/INSTALL.md#windows-build)

```powershell
cmake -S . -B build-win -G "Visual Studio 17 2022" -A x64 `
  -DCMAKE_PREFIX_PATH="C:/Qt/6.8.3/msvc2022_64;C:/deps/x64" `
  -DLIBP11_INCLUDE_DIR="C:/deps/libp11/src" `
  -DLIBP11_LIBRARY="C:/deps/libp11/src/libp11.lib"
cmake --build build-win --config Release
ctest --test-dir build-win -C Release --output-on-failure
cmake --install build-win --config Release --prefix dist/windows-x64
windeployqt --release --compiler-runtime "dist/windows-x64/NHIS Checker.exe"
```

Добави в директорията нужните DLL от OpenSSL, libxml2 и libp11 заедно с техните зависимости. За тестовете DLL файловете трябва да са достъпни през `PATH`. [Пакетиране с Qt](https://doc.qt.io/qt-6.8/windows-deployment.html)

