// 정적 이미지 자산을 ESM import로 사용하기 위한 모듈 선언.
// Metro가 require/import를 자산 ID(number)로 변환하며, RN Image의
// source(ImageSourcePropType)는 number를 허용한다.
declare module '*.png' {
  const content: number;
  export default content;
}

declare module '*.jpg' {
  const content: number;
  export default content;
}
