# CRUD-APIs
This is my attempt to create CRUD APIs for users.
Tech stack I used:
### Node.js
### MongoDB (mongoose)
### Redis (redis)
### Elasticsearch (elasticsearch)
### RabbitMQ (amqplib)

## Run 
```bash
  git clone https://github.com/amn-raw/CRUD-APIs.git
  npm init //initialize your project
  npm install   //to install all required dependencies
```
install kibana,elastic,redis,mongodb,rabbitMQ,nodemon

-start services
bin/kibana   to start kibana
bin/elastic  to start elastic
brew start services redis
brew start services mongodb7.0@community 
brew start services rabbitMQ
make sure to install nodejs client for each one it is mentioned above in bracket.
<br>
finally after all installation
run nodemon server.js in crud folder
you can access APIs at http://localhost:3000/
you can use Isomnia or ThunderClient to check API.
