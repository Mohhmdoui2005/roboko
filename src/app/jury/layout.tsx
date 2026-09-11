import RoleTopBar from '@/components/RoleTopBar'

export default function JuryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RoleTopBar role="JURY" />
      {children}
    </>
  )
}
