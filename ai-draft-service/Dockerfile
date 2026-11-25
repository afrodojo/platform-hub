FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn psycopg2-binary

COPY hitl_draft_service.py /app/hitl_draft_service.py

EXPOSE 8090
CMD ["uvicorn", "hitl_draft_service:app", "--host", "0.0.0.0", "--port", "8090"]