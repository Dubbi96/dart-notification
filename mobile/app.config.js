// app.config.js — app.json 을 베이스로, FCM google-services.json 경로만 빌드 시점에 주입한다.
//
// google-services.json 은 .gitignore 로 github 에서 제외된다(비밀 취급). EAS 빌드에는
// ★EAS 파일 환경변수 GOOGLE_SERVICES_JSON(secret, preview 환경)로 전달되어, 빌드 시 임시
// 경로로 materialize 되고 그 경로가 process.env.GOOGLE_SERVICES_JSON 에 들어온다.
// 로컬(expo start 등)에선 env 미설정 → 작업트리의 ./google-services.json 으로 폴백한다.
//
// app.config.js 가 있으면 Expo 가 이를 우선 사용하며 `config` 인자로 app.json 정적 설정을 받는다.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
});
