import argparse
import uvicorn


def main():
    parser = argparse.ArgumentParser(description="GeoTool FastAPI server")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--host", type=str, default="localhost", help="Server host")
    args = parser.parse_args()

    print(f"\n  GeoTool server -> http://{args.host}:{args.port}\n")
    uvicorn.run("geotool.server:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
