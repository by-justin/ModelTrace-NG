# Build from the repository root: docker build -f backend/Dockerfile -t modeltrace-api .
FROM golang:1.26 AS build
WORKDIR /src
COPY core ./core
COPY backend ./backend
WORKDIR /src/backend
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
COPY data/bank/bank.fb /bank.fb
ENV BANK_PATH=/bank.fb ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/api"]
