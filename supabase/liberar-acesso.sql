-- Libera as tabelas para usuários logados. As regras de acesso (RLS) do schema.sql
-- continuam valendo: professor só vê o que é dele, financeiro só admin.
-- Visitantes SEM login não recebem acesso a nenhuma tabela (só à função availability()).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
