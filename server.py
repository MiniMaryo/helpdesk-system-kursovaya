import hashlib
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import pg8000.dbapi


BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/helpdesk_db",
)


def get_connection():
    parsed = urlparse(DATABASE_URL)
    return pg8000.dbapi.connect(
        user=unquote(parsed.username or "postgres"),
        password=unquote(parsed.password or ""),
        host=parsed.hostname or "localhost",
        port=parsed.port or 5432,
        database=(parsed.path or "/helpdesk_db").lstrip("/"),
    )


def fetchone_dict(cur):
    row = cur.fetchone()
    if row is None:
        return None
    columns = [item[0] for item in cur.description]
    return dict(zip(columns, row))


def fetchall_dict(cur):
    columns = [item[0] for item in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    password_hash = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${password_hash}"


def check_password(password, saved_hash):
    salt, real_hash = saved_hash.split("$", 1)
    return hash_password(password, salt).split("$", 1)[1] == real_hash


def setup_database():
    schema = (BASE_DIR / "schema.sql").read_text(encoding="utf-8")
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(schema)
        seed_database(conn)
        conn.commit()
    finally:
        conn.close()


def seed_database(conn):
    cur = conn.cursor()
    try:
        cur.execute("select count(*) as total from employees")
        if fetchone_dict(cur)["total"]:
            return

        users = [
            ("Иванов Сергей", "Бухгалтерия", "ivanov", "123"),
            ("Петрова Анна", "Отдел продаж", "petrova", "123"),
        ]

        employee_ids = []
        for name, department, login, password in users:
            cur.execute(
                """
                insert into employees (full_name, department, login, password_hash)
                values (%s, %s, %s, %s)
                returning id
                """,
                (name, department, login, hash_password(password)),
            )
            employee_ids.append(fetchone_dict(cur)["id"])

        sample_tickets = [
            (
                employee_ids[0],
                "Программное обеспечение",
                "Не запускается 1С",
                "После обновления программа 1С не открывается и пишет ошибку подключения к базе.",
                "work",
                "high",
                [
                    ("new", "Сотрудник создал заявку и описал ошибку запуска."),
                    ("work", "Специалист проверяет доступность сервера и учетную запись."),
                ],
                [
                    ("employee", "Иванов Сергей", "Добрый день, ошибка повторяется после перезагрузки."),
                    ("support", "Техподдержка", "Здравствуйте. Проверяем сервер 1С, скоро напишем результат."),
                ],
            ),
            (
                employee_ids[1],
                "Оборудование",
                "Принтер печатает с полосами",
                "Принтер в кабинете 204 печатает документы с темными полосами по краю.",
                "wait",
                "medium",
                [
                    ("new", "Заявка принята в работу."),
                    ("work", "Проведена первичная диагностика устройства."),
                    ("wait", "Ожидается подтверждение от сотрудника после замены картриджа."),
                ],
                [
                    ("employee", "Петрова Анна", "Картридж меняли недавно, но полосы остались."),
                    ("support", "Техподдержка", "Поставили другой картридж, проверьте печать тестовой страницы."),
                ],
            ),
        ]

        for employee_id, category, title, description, status, priority, steps, messages in sample_tickets:
            cur.execute(
                """
                insert into tickets (employee_id, category, title, description, status, priority)
                values (%s, %s, %s, %s, %s, %s)
                returning id
                """,
                (employee_id, category, title, description, status, priority),
            )
            ticket_id = fetchone_dict(cur)["id"]

            for step_status, step_text in steps:
                cur.execute(
                    "insert into ticket_steps (ticket_id, status, text) values (%s, %s, %s)",
                    (ticket_id, step_status, step_text),
                )

            for author_type, author, text in messages:
                cur.execute(
                    """
                    insert into messages (ticket_id, author_type, author, text)
                    values (%s, %s, %s, %s)
                    """,
                    (ticket_id, author_type, author, text),
                )
    finally:
        cur.close()


def read_json(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if not length:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def get_tickets(role="employee", user_id=0):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
                """
                select
                    t.id,
                    t.employee_id as "employeeId",
                    e.full_name as "employeeName",
                    e.department,
                    t.category,
                    t.title,
                    t.description,
                    t.status,
                    t.priority,
                    t.created_at as "createdAt"
                from tickets t
                join employees e on e.id = t.employee_id
                order by t.created_at desc
                """
        )
        tickets = fetchall_dict(cur)

        cur.execute(
                """
                select id, ticket_id as "ticketId", status, text, created_at as "createdAt"
                from ticket_steps
                order by created_at
                """
        )
        steps = fetchall_dict(cur)

        if role == "support":
            cur.execute(
                    """
                    select id, ticket_id as "ticketId", author_type as type, author, text, created_at as "createdAt"
                    from messages
                    order by created_at
                    """
            )
            messages = fetchall_dict(cur)
        else:
            cur.execute(
                    """
                    select m.id, m.ticket_id as "ticketId", m.author_type as type, m.author, m.text, m.created_at as "createdAt"
                    from messages m
                    join tickets t on t.id = m.ticket_id
                    where t.employee_id = %s
                    order by m.created_at
                    """,
                    (user_id,),
            )
            messages = fetchall_dict(cur)
    finally:
        conn.close()

    for ticket in tickets:
        ticket["steps"] = [step for step in steps if step["ticketId"] == ticket["id"]]
        ticket["messages"] = [message for message in messages if message["ticketId"] == ticket["id"]]
    return tickets


class HelpDeskHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/tickets":
            query = parse_qs(parsed.query)
            role = query.get("role", ["employee"])[0]
            user_id = int(query.get("userId", [0])[0])
            self.send_json(get_tickets(role, user_id))
            return

        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        data = read_json(self)

        if parsed.path == "/api/register":
            self.register_employee(data)
            return

        if parsed.path == "/api/login":
            self.login(data)
            return

        if parsed.path == "/api/tickets":
            self.create_ticket(data)
            return

        parts = parsed.path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "tickets"] and parts[3] == "steps":
            self.add_step(int(parts[2]), data)
            return

        if len(parts) == 4 and parts[:2] == ["api", "tickets"] and parts[3] == "messages":
            self.add_message(int(parts[2]), data)
            return

        self.send_error(404)

    def do_PATCH(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "tickets"]:
            self.update_ticket(int(parts[2]), read_json(self))
            return
        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "tickets"]:
            query = parse_qs(parsed.query)
            role = query.get("role", [""])[0]
            self.delete_ticket(int(parts[2]), role)
            return
        self.send_error(404)

    def register_employee(self, data):
        conn = get_connection()
        try:
            cur = conn.cursor()
            try:
                cur.execute(
                        """
                        insert into employees (full_name, department, login, password_hash)
                        values (%s, %s, %s, %s)
                        returning id, full_name, department, login
                        """,
                        (
                            data["name"].strip(),
                            data["department"].strip(),
                            data["login"].strip(),
                            hash_password(data["password"]),
                        ),
                )
                employee = fetchone_dict(cur)
                conn.commit()
            except pg8000.dbapi.IntegrityError:
                conn.rollback()
                self.send_json({"error": "Такой логин уже занят"}, 409)
                return
        finally:
            conn.close()

        self.send_json(employee_to_user(employee), 201)

    def login(self, data):
        if data.get("login") == "admin" and data.get("password") == "admin":
            self.send_json(
                {
                    "type": "support",
                    "id": 0,
                    "name": "Администратор техподдержки",
                    "department": "IT-отдел",
                }
            )
            return

        if data.get("role") == "support":
            self.send_json({"error": "Неверный логин или пароль"}, 401)
            return

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                    "select id, full_name, department, login, password_hash from employees where login = %s",
                    (data.get("login", "").strip(),),
            )
            employee = fetchone_dict(cur)
        finally:
            conn.close()

        if not employee or not check_password(data.get("password", ""), employee["password_hash"]):
            self.send_json({"error": "Неверный логин или пароль"}, 401)
            return

        self.send_json(employee_to_user(employee))

    def create_ticket(self, data):
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                    """
                    insert into tickets (employee_id, category, title, description, status, priority)
                    values (%s, %s, %s, %s, %s, %s)
                    returning id
                    """,
                    (
                        data["employeeId"],
                        data["category"],
                        data["title"].strip(),
                        data["description"].strip(),
                        data["status"],
                        data.get("priority", "medium"),
                    ),
            )
            ticket_id = fetchone_dict(cur)["id"]
            cur.execute(
                    "insert into ticket_steps (ticket_id, status, text) values (%s, %s, %s)",
                    (ticket_id, data["status"], "Сотрудник создал заявку: " + data["description"].strip()),
            )
            cur.execute(
                    """
                    insert into messages (ticket_id, author_type, author, text)
                    values (%s, 'employee', %s, %s)
                    """,
                    (ticket_id, data["employeeName"], data["description"].strip()),
            )
            conn.commit()
        finally:
            conn.close()

        self.send_json({"id": ticket_id}, 201)

    def update_ticket(self, ticket_id, data):
        fields = []
        values = []
        if "status" in data:
            fields.append("status = %s")
            values.append(data["status"])
        if "priority" in data:
            fields.append("priority = %s")
            values.append(data["priority"])

        conn = get_connection()
        try:
            cur = conn.cursor()
            if fields:
                values.append(ticket_id)
                cur.execute(f"update tickets set {', '.join(fields)} where id = %s", values)
            if data.get("stepText"):
                cur.execute(
                        "insert into ticket_steps (ticket_id, status, text) values (%s, %s, %s)",
                        (ticket_id, data.get("status", "work"), data["stepText"]),
                )
            conn.commit()
        finally:
            conn.close()

        self.send_json({"ok": True})

    def delete_ticket(self, ticket_id, role):
        if role != "support":
            self.send_json({"error": "Удалять тикеты может только техподдержка"}, 403)
            return

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("select status from tickets where id = %s", (ticket_id,))
            row = cur.fetchone()

            if not row:
                self.send_json({"error": "Тикет не найден"}, 404)
                return

            if row[0] != "closed":
                self.send_json({"error": "Удалять можно только закрытые тикеты"}, 409)
                return

            cur.execute("delete from tickets where id = %s", (ticket_id,))
            conn.commit()
        finally:
            conn.close()

        self.send_json({"ok": True})

    def add_step(self, ticket_id, data):
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("update tickets set status = %s where id = %s", (data["status"], ticket_id))
            cur.execute(
                    "insert into ticket_steps (ticket_id, status, text) values (%s, %s, %s)",
                    (ticket_id, data["status"], data["text"].strip()),
            )
            conn.commit()
        finally:
            conn.close()
        self.send_json({"ok": True}, 201)

    def add_message(self, ticket_id, data):
        conn = get_connection()
        try:
            cur = conn.cursor()
            if data.get("role") != "support":
                cur.execute("select employee_id from tickets where id = %s", (ticket_id,))
                row = cur.fetchone()
                if not row or int(row[0]) != int(data.get("employeeId", 0)):
                    self.send_json({"error": "Нет доступа к чату этого тикета"}, 403)
                    return

            cur.execute(
                    """
                    insert into messages (ticket_id, author_type, author, text)
                    values (%s, %s, %s, %s)
                    """,
                    (ticket_id, data["type"], data["author"], data["text"].strip()),
            )
            conn.commit()
        finally:
            conn.close()
        self.send_json({"ok": True}, 201)

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"

        file_path = (BASE_DIR / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(BASE_DIR)) or not file_path.exists():
            self.send_error(404)
            return

        content_type = "text/plain; charset=utf-8"
        if file_path.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif file_path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif file_path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"

        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def employee_to_user(employee):
    return {
        "type": "employee",
        "id": employee["id"],
        "name": employee["full_name"],
        "department": employee["department"],
        "login": employee["login"],
    }


if __name__ == "__main__":
    setup_database()
    server = ThreadingHTTPServer(("localhost", 8000), HelpDeskHandler)
    print("Сервер запущен: http://localhost:8000")
    print("PostgreSQL:", DATABASE_URL)
    server.serve_forever()
