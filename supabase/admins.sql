-- Marca usuários como administradores.
-- Rode DEPOIS de criar os usuários em Authentication > Users (Add user > Create new user).
-- Troque os e-mails abaixo pelos dos administradores reais.
insert into profiles (id, role, name, email)
select id, 'admin', split_part(email, '@', 1), email
from auth.users
where email in ('admin1@exemplo.com', 'admin2@exemplo.com')
on conflict (id) do update set role = 'admin', active = true;

-- Conferência: deve listar os administradores.
select name, email, role from profiles where role = 'admin';
