FROM postgres:latest

# Set environment variables for PostgreSQL
ENV POSTGRES_DB=deno_orm
ENV POSTGRES_USER=openroom-admin
ENV POSTGRES_PASSWORD=openroom-password

# Expose the PostgreSQL default port
EXPOSE 5432