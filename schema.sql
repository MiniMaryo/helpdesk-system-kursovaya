create table if not exists employees (
  id bigserial primary key,
  full_name varchar(160) not null,
  department varchar(120) not null,
  login varchar(80) not null unique,
  password_hash varchar(120) not null,
  created_at timestamp not null default now()
);

create table if not exists tickets (
  id bigserial primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  category varchar(80) not null,
  title varchar(200) not null,
  description text not null,
  status varchar(30) not null default 'new',
  priority varchar(30) not null default 'medium',
  created_at timestamp not null default now()
);

create table if not exists ticket_steps (
  id bigserial primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  status varchar(30) not null,
  text text not null,
  created_at timestamp not null default now()
);

create table if not exists messages (
  id bigserial primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  author_type varchar(30) not null,
  author varchar(160) not null,
  text text not null,
  created_at timestamp not null default now()
);

create index if not exists idx_tickets_employee_id on tickets(employee_id);
create index if not exists idx_tickets_status on tickets(status);
create index if not exists idx_ticket_steps_ticket_id on ticket_steps(ticket_id);
create index if not exists idx_messages_ticket_id on messages(ticket_id);
