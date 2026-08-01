const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// AOS Rule Evaluator는 서버와 모바일이 같은 TypeScript 원본을 직접 소비한다.
// 패키지의 런타임 dependency는 0이며, Metro가 저장소 상위 공유 소스를 감시하도록 명시한다.
config.watchFolders = [path.resolve(__dirname, '..')];

const { transformer, resolver } = config;

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer/expo'),
};

config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
  nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  extraNodeModules: {
    ...(resolver.extraNodeModules ?? {}),
    '@dart-notification/aos-rule-engine': path.resolve(
      __dirname,
      '../packages/aos-rule-engine',
    ),
  },
};

module.exports = config;
