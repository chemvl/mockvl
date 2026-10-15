import { useAdminStore } from '@/refine/adminStore';

export const AvatarName = () => {
  const identity = useAdminStore((s) => s.identity);
  const displayName = identity?.name || identity?.email || '';
  return (
    <span className="anticon" style={{ display: 'block' }}>
      {displayName}
    </span>
  );
};
