// Signs release builds with the shop's own key when android/keystore.properties exists.
// That file and the keystore stay out of git (see .gitignore). Without them, release builds
// fall back to the debug key so they still build, and must not be given to the shop.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// laundry-pos: release signing';

const SIGNING_CONFIG = `
        release {
            ${MARKER}
            def props = new Properties()
            def propsFile = rootProject.file('keystore.properties')
            if (propsFile.exists()) {
                propsFile.withInputStream { props.load(it) }
                storeFile rootProject.file(props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    const debugBlock = /signingConfigs \{\n(\s+debug \{[\s\S]*?\n\s+\})/;
    if (!debugBlock.test(gradle)) {
      throw new Error('withReleaseSigning: could not find signingConfigs.debug in app/build.gradle');
    }
    gradle = gradle.replace(debugBlock, (match) => `${match}${SIGNING_CONFIG}`);
    gradle = gradle.replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig rootProject.file('keystore.properties').exists() ? signingConfigs.release : signingConfigs.debug",
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
