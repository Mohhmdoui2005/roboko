import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getSession() parses the local cookie and returns the JWT payload.
  // It does NOT make a network request to the Supabase Auth server, satisfying the <50ms zero-DB constraint.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const { pathname } = request.nextUrl

  // Allow public assets and login
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/login') ||
    pathname === '/live' ||
    pathname === '/' ||
    pathname === '/favicon.ico' ||
    pathname === '/sw.js'
  ) {
    return supabaseResponse
  }

  // If no session, redirect to login
  if (!session) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Extract custom claims from raw_app_meta_data
  const role = session.user.app_metadata?.role

  // Role-based routing protection
  const redirectLogin = () => {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/admin') && role !== 'ADMIN') {
    return redirectLogin()
  }
  
  if (pathname.startsWith('/orga') && role !== 'ORGA' && role !== 'ADMIN') {
    return redirectLogin()
  }

  if (pathname.startsWith('/jury') && role !== 'JURY' && role !== 'ADMIN') {
    return redirectLogin()
  }

  if (pathname.startsWith('/participant') && role !== 'PARTICIPANT' && role !== 'ADMIN') {
    return redirectLogin()
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
