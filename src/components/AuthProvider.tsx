'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Session } from '@supabase/supabase-js'

type AuthContextType = {
  user: User | null
  session: Session | null
  role: string | null
  arenaId: string | null
  teamId: string | null
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  arenaId: null,
  teamId: null,
  isLoading: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [arenaId, setArenaId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    const initializeAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (session) {
        setSession(session)
        setUser(session.user)
        
        // Read custom claims from JWT (injected via database trigger)
        // No extra DB fetch required!
        const metadata = session.user.app_metadata || {}
        setRole(metadata.role || 'PARTICIPANT')
        setArenaId(metadata.assigned_arena || null)
        setTeamId(metadata.team_id || null)
      }
      setIsLoading(false)
    }

    initializeAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user || null)
      
      if (newSession?.user) {
        const metadata = newSession.user.app_metadata || {}
        setRole(metadata.role || 'PARTICIPANT')
        setArenaId(metadata.assigned_arena || null)
        setTeamId(metadata.team_id || null)
      } else {
        setRole(null)
        setArenaId(null)
        setTeamId(null)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, role, arenaId, teamId, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
