import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRole = process.env.SUPABASE_SERVICE_ROLE!

export const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false }
})