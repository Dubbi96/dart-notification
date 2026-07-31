import { permissionsForRole, roleHasPermissions } from './operator-permissions';

describe('operator RBAC', () => {
  it('VIEWER는 조회만 가능하다', () => {
    expect(roleHasPermissions('VIEWER', ['OPERATOR_READ'])).toBe(true);
    expect(roleHasPermissions('VIEWER', ['CONFIG_WRITE'])).toBe(false);
  });

  it('작성자와 승인자 권한을 분리한다', () => {
    expect(roleHasPermissions('EDITOR', ['CONFIG_WRITE'])).toBe(true);
    expect(roleHasPermissions('EDITOR', ['CONFIG_APPROVE'])).toBe(false);
    expect(roleHasPermissions('APPROVER', ['CONFIG_APPROVE'])).toBe(true);
    expect(roleHasPermissions('APPROVER', ['CONFIG_WRITE'])).toBe(false);
  });

  it('ADMIN만 전체 권한을 가진다', () => {
    expect(permissionsForRole('ADMIN')).toHaveLength(5);
    expect(roleHasPermissions('RISK_OFFICER', ['CONFIG_WRITE'])).toBe(false);
  });
});
