import { Feather } from '@expo/vector-icons';
import { emptyStateCopy } from '@components/common/emptyStateCopy';

// 빈 상태 마이크로카피 정본 테이블(ux-detail-plan §2-2) 전수성 가드.
describe('components/common/emptyStateCopy', () => {
  const entries = Object.entries(emptyStateCopy);

  it('모든 항목이 비어있지 않은 title 을 가진다', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [, copy] of entries) {
      expect(copy.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('모든 icon 이 실제 Feather 글리프에 존재한다(오타 시 물음표 아이콘 회귀 방지)', () => {
    for (const [key, copy] of entries) {
      expect(`${key}:${copy.icon in Feather.glyphMap}`).toBe(`${key}:true`);
    }
  });

  it('actionLabel 이 정의된 항목은 빈 문자열이 아니다(빈 버튼 렌더 방지)', () => {
    for (const [, copy] of entries) {
      if ('actionLabel' in copy && copy.actionLabel !== undefined) {
        expect(copy.actionLabel.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
