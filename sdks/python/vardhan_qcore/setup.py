from setuptools import setup, find_packages

setup(
    name="vardhan-qcore",
    version="1.0.0",
    description="Vardhan Q-Core Enterprise Tollbooth SDK",
    packages=find_packages(),
    install_requires=[
        "requests>=2.25.0",
    ],
)
