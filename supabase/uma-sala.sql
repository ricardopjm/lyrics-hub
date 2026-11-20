-- O estúdio tem uma única sala. Remove as salas 2 e 3 e renomeia a primeira.
delete from rooms where name in ('Sala 2', 'Sala 3');
update rooms set name = 'Sala' where name = 'Sala 1';
select id, name from rooms;
