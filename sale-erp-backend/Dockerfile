FROM eclipse-temurin:25-jdk AS builder
WORKDIR /app

COPY . ./
RUN chmod +x mvnw
RUN ./mvnw clean package -DskipTests
RUN find target -maxdepth 1 -type f -name "*.jar" ! -name "*.jar.original" -exec cp {} /app/app.jar \;

FROM eclipse-temurin:25-jre
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_OPTS=""

COPY --from=builder /app/app.jar /app/app.jar

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl --fail --silent http://localhost:8081/v3/api-docs > /dev/null || exit 1

CMD ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
