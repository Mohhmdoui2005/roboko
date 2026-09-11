import RoleTopBar from '@/components/RoleTopBar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RoleTopBar role="ADMIN" />
      {children}
    </>
  )
}
