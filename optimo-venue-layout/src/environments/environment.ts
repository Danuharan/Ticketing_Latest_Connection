/**
 * App + Supabase config.
 * Publishable key is safe in client code (RLS protects data). Do not put service-role keys here.
 */
export const environment = {
  production: false,
  supabase: {
    // Ticketing_New_Tables-Checking
    url: 'https://zvfjrgikjbpcovctjgln.supabase.co',
    publishableKey: 'sb_publishable_5csRRwinA9hAOt7bchvwpQ_jhk231aE',
  },
};
