# NHIS Checker

Настолно приложение за извличане на дентален статус (D009 → D010) и лечения (D005 → D006). Интерфейсът е вграден в приложението и заявките се изпращат директно към избраната среда на НЗИС.

Готовите DMG пакети за macOS 12.0 и по-нови версии се публикуват в [Releases](https://github.com/aidoo-dental/nhis-checker/releases), отделно за Apple Silicon и Intel. Името на всеки пакет включва версията.

За Windows 10 (1809+) и Windows 11 x64 се предлага EXE инсталатор. Инсталира се за текущия потребител, създава пряк път в Start менюто и включва нужните библиотеки. Драйверът за КЕП се инсталира отделно от доставчика и трябва да е 64-битов. Инсталаторът засега няма Authenticode подпис.

## Работа с приложението

1. В „Настройки“ въведи ЛПК и РЗИ номера на практиката, избери среда и запази. При първо стартиране е избрана тестовата среда.
2. Включи КЕП токена и използвай „Провери КЕП“ за локален пробен подпис. При нужда избери PKCS#11 драйвера на доставчика. Архитектурата на драйвера трябва да съвпада с тази на приложението.
3. Въведи име, фамилия, тип идентификатор и идентификатор на пациента. Презимето е по желание. Бутонът за справката отваря съответния таб. „Изтегли XML“ запазва оригиналния отговор за тази справка.

Преди показване или експортиране приложението сравнява идентификатора, типа му, името и фамилията с пациентските данни във всеки върнат D006 запис. Ако е въведено презиме, проверява и него. Разликите в главни/малки букви и излишни интервали се игнорират; съкратени имена, правописни грешки и транслитерация не се приемат. При несъответствие или липса на данни за проверка справката се блокира, без да се показват върнатите имена.

D010 не съдържа пациентски имена, затова преди заявката за статус се прави D005/D006 проверка. Не се използва запомнено потвърждение от предишна справка. Ако НЗИС не върне дентални записи с пациентски данни, и статусът остава блокиран. Това е проверка спрямо върнатите записи на НЗИС, а не отделна справка в ГРАО. D005 се изпраща по идентификатор според спецификацията; добавянето на имена към този режим води до грешка E002.

При включено запомняне приложението държи отключената КЕП сесия до два часа. ПИН кодът не се записва на диск. „Заключи КЕП“ прекратява сесията веднага.

„Статус по дати“ използва върнатите от НЗИС дати на дейности и последните известни състояния по зъб. За зъб без запис към избраната дата се показва „Няма данни“.

Настройките се отварят в страничен панел. Кратките известия се скриват автоматично. „Журнал на грешките“ пази последните 100 грешки на компютъра с дата, среда и версия на приложението и позволява копиране и изчистване.

## Код

- `app/protocol.cpp` създава XML заявките и проверява вида и идентификатора на отговора.
- `app/nhis.cpp` управлява автентикацията, токена и заявките към НЗИС.
- `app/signing.cpp` и `app/xml_signature.cpp` управляват PKCS#11 сесията и XAdES подписването.
- `app/ui/` съдържа интерфейса, обработката на XML, одонтограмата и таблицата за лечения.
- `tests/protocol_signature.cpp` проверява XML заявките и верифицира подписа с локален тестов сертификат.

Подписването е адаптирано от [DinoDent](https://github.com/thefinalcutbg/DinoDent). Денталните SVG изображения и иконите за статус са от AIDOO. XML полетата и етикетите използват [спецификацията](https://docs.google.com/spreadsheets/d/1SOLwRGWEb0McPhBME2lbi2OVRpkRwQlfN_4cMv7Y5vk/edit) и [номенклатурите на НЗИС](https://docs.google.com/spreadsheets/d/11V7vP_dcqIPoLfbM69vSGtW8YvyjtxETXOiOWkFoy_Q/edit).

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

Workflow-ът `.github/workflows/windows.yml` компилира с MSVC 2022, Qt 6.8.3, OpenSSL, libxml2 и libp11. Изпълнява протоколните тестове и проверява всички вградени ресурси, пакетира чрез Inno Setup 6, инсталира EXE файла и проверява реалния интерфейс, връзката с приложението, известията и журнала. Накрая проверява деинсталирането. Готовият инсталатор е в артефакта `NHIS-Checker-Windows-x64` на успешния run.

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
