import React, { createContext, useContext, useEffect, useState } from 'react';
import { DEMO, supabase } from './supabase';
import { demoUser, loadProfile, Role, User } from './data';
import { registerForPush, unregisterPush } from '../push';

type Ctx = {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInDemo: (role: Role) => void;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>(null as never);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(DEMO);

  useEffect(() => {
    if (DEMO) return;
    const load = async (id?: string) => {
      try { setUser(id ? await loadProfile(id) : null); } catch { setUser(null); }
      setReady(true);
    };
    supabase.auth.getSession().then(({ data }: any) => load(data.session?.user.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_e: any, s: any) => { load(s?.user.id); });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Depois do login, registra este celular para receber avisos.
  useEffect(() => { if (user && !DEMO) registerForPush(); }, [user?.id]);

  const value: Ctx = {
    user, ready,
    signIn: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error('E-mail ou senha incorretos.');
      try {
        await loadProfile(data.user.id);
      } catch (e: any) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error(e?.message === 'pending'
          ? 'Seu cadastro está aguardando a confirmação do pagamento. Assim que a Lyrics confirmar, o seu acesso é liberado.'
          : e?.message === 'inactive'
          ? 'Este acesso foi desativado. Fale com um administrador.'
          : 'Seu usuário ainda não tem perfil de acesso. Fale com um administrador.');
      }
    },
    signInDemo: (role) => setUser(demoUser(role)),
    signOut: async () => { if (!DEMO) { await unregisterPush(); await supabase.auth.signOut({ scope: 'local' }); } setUser(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
