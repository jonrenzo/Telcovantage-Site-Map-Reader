from flask import Flask, render_template

def create_app():
    app = Flask(__name__)
    app.config.from_pyfile('config.py')

    # Serve the frontend on the root URL
    @app.route('/')
    def index():
        return render_template('index.html')

    # Register the API routes under the /api prefix
    from app.api.routes import main_api
    app.register_blueprint(main_api, url_prefix='/api')

    return app