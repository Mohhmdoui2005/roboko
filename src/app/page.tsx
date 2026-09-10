import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/live') // Root defaults to live screen for public
  }

  const role = session.user.app_metadata?.role

  if (role === 'ADMIN') redirect('/admin')
  if (role === 'ORGA') redirect('/orga')
  if (role === 'JURY') redirect('/jury')
  
  redirect('/participant')
}
