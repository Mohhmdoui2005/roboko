'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {
      // proceed to login even if the sign-out request fails
    }
    window.location.assign('/login')
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={signingOut}
      className="btn"
      style={{ minHeight: 36, padding: '0 0.9rem', fontSize: '0.8rem' }}
    >
      {signingOut ? 'Signing out…' : '⏻ Sign out'}
    </button>
  )
}
