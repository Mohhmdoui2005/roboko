import RoleTopBar from '@/components/RoleTopBar'

export default function ParticipantLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RoleTopBar role="PARTICIPANT" />
      {children}
    </>
  )
}
