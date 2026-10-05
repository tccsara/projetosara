// A chave publicável pode ficar no frontend. Nunca coloque aqui a service_role key.
const SARA_SUPABASE_URL = 'https://xjpzflzysnjfcrqwjfli.supabase.co';
const SARA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WZaBKQadYINTPSrXoHbaWQ_m6fWQ5x9';

if (!window.supabase || !window.supabase.createClient) {
    console.error('O SDK do Supabase não foi carregado.');
} else if (SARA_SUPABASE_PUBLISHABLE_KEY.startsWith('COLE_')) {
    console.warn('Cole a chave publicável do Supabase em assets/js/supabase-client.js.');
} else {
    window.saraSupabase = window.supabase.createClient(
        SARA_SUPABASE_URL,
        SARA_SUPABASE_PUBLISHABLE_KEY
    );
}
