import RoleTopBar from '@/components/RoleTopBar'

export default function OrgaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RoleTopBar role="ORGA" />
      {children}
    </>
  )
}
