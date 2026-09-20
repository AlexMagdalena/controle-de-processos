import { supabase } from './supabase';

const loginForm = document.getElementById('login-form') as HTMLFormElement;
const errorMsg = document.getElementById('login-error');

loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('email') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        if (errorMsg) errorMsg.textContent = 'Credenciais inválidas.';
        return;
    }

    // Verifica primeiro acesso
    const { data: profile } = await supabase.from('profiles').select('must_change_password').eq('id', data.user.id).single();
    
    if (profile?.must_change_password) {
        const modal = document.getElementById('modal-first-access') as HTMLDialogElement;
        modal.showModal();
        
        document.getElementById('reset-pwd-form')?.addEventListener('submit', async (e2) => {
            e2.preventDefault();
            const newPwd = (document.getElementById('new-pwd') as HTMLInputElement).value;
            await supabase.auth.updateUser({ password: newPwd });
            await supabase.from('profiles').update({ must_change_password: false }).eq('id', data.user.id);
            window.location.href = '/index.html';
        });
    } else {
        window.location.href = '/index.html';
    }
});